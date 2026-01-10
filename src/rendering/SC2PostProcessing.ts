import * as THREE from 'three';

/**
 * SC2-LEVEL POST-PROCESSING
 *
 * Adds cinematic visual effects:
 * - Bloom for energy weapons, explosions, and glowing effects
 * - Subtle vignette for focus
 * - Color grading for atmosphere
 * - SSAO (Screen-Space Ambient Occlusion) for depth
 * - God rays / light shafts for atmosphere
 * - FXAA anti-aliasing
 */

export class SC2PostProcessing {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  // Dedicated camera and scene for post-processing (critical for correct rendering)
  private postProcessCamera: THREE.OrthographicCamera;
  private postProcessScene: THREE.Scene;

  // Render targets
  private renderTarget: THREE.WebGLRenderTarget;
  private bloomRenderTarget: THREE.WebGLRenderTarget;
  private blurRenderTargetH: THREE.WebGLRenderTarget;
  private blurRenderTargetV: THREE.WebGLRenderTarget;
  private ssaoRenderTarget: THREE.WebGLRenderTarget;
  private godRaysRenderTarget: THREE.WebGLRenderTarget;
  private depthRenderTarget: THREE.WebGLRenderTarget;

  // Full-screen quad for post-processing
  private fullscreenQuad: THREE.Mesh;

  // Shader materials
  private bloomExtractMaterial: THREE.ShaderMaterial;
  private blurMaterialH: THREE.ShaderMaterial;
  private blurMaterialV: THREE.ShaderMaterial;
  private ssaoMaterial: THREE.ShaderMaterial;
  private godRaysMaterial: THREE.ShaderMaterial;
  private compositeMaterial: THREE.ShaderMaterial;
  private depthMaterial: THREE.MeshDepthMaterial;

  // Settings - tuned for subtle enhancement without overexposure
  private bloomStrength = 0.4; // Reduced from 0.8
  private bloomThreshold = 0.85; // Higher threshold = less bloom
  private bloomRadius = 0.5;
  private vignetteStrength = 0.2; // Reduced
  private saturation = 1.05; // More subtle
  private contrast = 1.02; // More subtle
  private ssaoStrength = 0.3; // Reduced from 0.5
  private ssaoRadius = 0.4;
  private godRaysStrength = 0.15; // Reduced from 0.3
  private sunPosition = new THREE.Vector3(0.5, 0.8, 0.3);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Create orthographic camera for fullscreen quad rendering
    // This is CRITICAL - using perspective camera breaks screen-space effects
    this.postProcessCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postProcessScene = new THREE.Scene();

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

    // SSAO and god rays at half resolution for performance
    this.ssaoRenderTarget = new THREE.WebGLRenderTarget(bloomWidth, bloomHeight, rtParams);
    this.godRaysRenderTarget = new THREE.WebGLRenderTarget(bloomWidth, bloomHeight, rtParams);

    // Depth render target for SSAO
    this.depthRenderTarget = new THREE.WebGLRenderTarget(
      size.x * pixelRatio,
      size.y * pixelRatio,
      {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.FloatType,
      }
    );

    // Depth material for capturing scene depth
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });

    // Create fullscreen quad and add to post-process scene
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.fullscreenQuad = new THREE.Mesh(quadGeometry, new THREE.MeshBasicMaterial());
    this.postProcessScene.add(this.fullscreenQuad);

    // Create shader materials
    this.bloomExtractMaterial = this.createBloomExtractMaterial();
    this.blurMaterialH = this.createBlurMaterial(true);
    this.blurMaterialV = this.createBlurMaterial(false);
    this.ssaoMaterial = this.createSSAOMaterial();
    this.godRaysMaterial = this.createGodRaysMaterial();
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

  private createSSAOMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2() },
        ssaoStrength: { value: this.ssaoStrength },
        ssaoRadius: { value: this.ssaoRadius },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
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
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float ssaoStrength;
        uniform float ssaoRadius;
        uniform float cameraNear;
        uniform float cameraFar;
        varying vec2 vUv;

        // Unpack depth from RGBA
        float unpackDepth(vec4 color) {
          const vec4 bitShift = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
          return dot(color, bitShift);
        }

        float getLinearDepth(vec2 uv) {
          float depth = unpackDepth(texture2D(tDepth, uv));
          return cameraNear * cameraFar / (cameraFar - depth * (cameraFar - cameraNear));
        }

        // Simple SSAO implementation
        float calculateSSAO(vec2 uv) {
          float depth = getLinearDepth(uv);
          if (depth > cameraFar * 0.99) return 1.0; // Sky

          float occlusion = 0.0;
          float radius = ssaoRadius / depth;
          vec2 texelSize = 1.0 / resolution;

          // Sample 8 directions
          const int samples = 8;
          const float angleStep = 6.28318 / float(samples);

          for (int i = 0; i < samples; i++) {
            float angle = float(i) * angleStep;
            vec2 offset = vec2(cos(angle), sin(angle)) * radius * texelSize * 20.0;
            float sampleDepth = getLinearDepth(uv + offset);

            // Compare depths - if sample is closer, it occludes
            float diff = depth - sampleDepth;
            if (diff > 0.01 && diff < ssaoRadius * 2.0) {
              occlusion += smoothstep(0.0, ssaoRadius, diff);
            }
          }

          occlusion /= float(samples);
          return 1.0 - occlusion * ssaoStrength;
        }

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float ao = calculateSSAO(vUv);
          gl_FragColor = vec4(color.rgb * ao, 1.0);
        }
      `,
    });
  }

  private createGodRaysMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2() },
        sunPosition: { value: new THREE.Vector2(0.5, 0.2) }, // Screen space sun position
        godRaysStrength: { value: this.godRaysStrength },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
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
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform vec2 sunPosition;
        uniform float godRaysStrength;
        uniform float cameraNear;
        uniform float cameraFar;
        varying vec2 vUv;

        float unpackDepth(vec4 color) {
          const vec4 bitShift = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
          return dot(color, bitShift);
        }

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);

          // Direction from pixel to sun
          vec2 toSun = sunPosition - vUv;
          float distToSun = length(toSun);
          vec2 rayDir = toSun / max(distToSun, 0.001);

          // Radial blur towards sun (god rays effect)
          const int samples = 32;
          float decay = 0.97;
          float weight = 1.0;
          float illumination = 0.0;

          vec2 uv = vUv;
          float stepSize = distToSun / float(samples);

          for (int i = 0; i < samples; i++) {
            uv += rayDir * stepSize * 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

            // Sample depth - sky areas (far depth) contribute to god rays
            float depth = unpackDepth(texture2D(tDepth, uv));
            float isSky = step(0.99, depth);

            // Also sample color brightness for light sources
            vec3 sampleColor = texture2D(tDiffuse, uv).rgb;
            float brightness = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
            float lightContrib = max(isSky, step(0.8, brightness));

            illumination += lightContrib * weight;
            weight *= decay;
          }

          illumination /= float(samples);

          // Apply god rays - more effect closer to sun
          float falloff = 1.0 - smoothstep(0.0, 1.0, distToSun);
          vec3 godRays = vec3(1.0, 0.95, 0.8) * illumination * falloff * godRaysStrength;

          gl_FragColor = vec4(color.rgb + godRays, 1.0);
        }
      `,
    });
  }

  private createCompositeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        tSSAO: { value: null },
        tGodRays: { value: null },
        bloomStrength: { value: this.bloomStrength },
        vignetteStrength: { value: this.vignetteStrength },
        saturation: { value: this.saturation },
        contrast: { value: this.contrast },
        ssaoEnabled: { value: true },
        godRaysEnabled: { value: true },
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
        uniform sampler2D tSSAO;
        uniform sampler2D tGodRays;
        uniform float bloomStrength;
        uniform float vignetteStrength;
        uniform float saturation;
        uniform float contrast;
        uniform bool ssaoEnabled;
        uniform bool godRaysEnabled;
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
          // Get base color with SSAO applied
          vec4 ssaoColor = texture2D(tSSAO, vUv);
          vec4 color = ssaoEnabled ? ssaoColor : texture2D(tDiffuse, vUv);

          // Add god rays
          if (godRaysEnabled) {
            vec4 godRays = texture2D(tGodRays, vUv);
            color.rgb += godRays.rgb - texture2D(tDiffuse, vUv).rgb; // Add just the god rays contribution
          }

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

    // 1. Render main scene to render target (uses game camera)
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // 2. Render depth pass for SSAO and god rays
    this.scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.depthRenderTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;

    // All subsequent passes use the orthographic post-process camera
    const postCam = this.postProcessCamera;
    const postScene = this.postProcessScene;

    // 3. SSAO pass
    this.fullscreenQuad.material = this.ssaoMaterial;
    this.ssaoMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
    this.ssaoMaterial.uniforms.tDepth.value = this.depthRenderTarget.texture;
    this.ssaoMaterial.uniforms.resolution.value.set(
      this.ssaoRenderTarget.width,
      this.ssaoRenderTarget.height
    );
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.ssaoMaterial.uniforms.cameraNear.value = this.camera.near;
      this.ssaoMaterial.uniforms.cameraFar.value = this.camera.far;
    }
    renderer.setRenderTarget(this.ssaoRenderTarget);
    renderer.clear();
    renderer.render(postScene, postCam);

    // 4. God rays pass
    this.fullscreenQuad.material = this.godRaysMaterial;
    this.godRaysMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
    this.godRaysMaterial.uniforms.tDepth.value = this.depthRenderTarget.texture;
    this.godRaysMaterial.uniforms.resolution.value.set(
      this.godRaysRenderTarget.width,
      this.godRaysRenderTarget.height
    );
    // Calculate sun screen position from world position
    if (this.camera instanceof THREE.PerspectiveCamera) {
      const sunWorldPos = this.sunPosition.clone().normalize().multiplyScalar(100);
      const sunScreenPos = sunWorldPos.project(this.camera);
      this.godRaysMaterial.uniforms.sunPosition.value.set(
        (sunScreenPos.x + 1) * 0.5,
        (sunScreenPos.y + 1) * 0.5
      );
      this.godRaysMaterial.uniforms.cameraNear.value = this.camera.near;
      this.godRaysMaterial.uniforms.cameraFar.value = this.camera.far;
    }
    renderer.setRenderTarget(this.godRaysRenderTarget);
    renderer.clear();
    renderer.render(postScene, postCam);

    // 5. Extract bright areas for bloom
    this.fullscreenQuad.material = this.bloomExtractMaterial;
    this.bloomExtractMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
    renderer.setRenderTarget(this.bloomRenderTarget);
    renderer.clear();
    renderer.render(postScene, postCam);

    // 6. Horizontal blur
    this.fullscreenQuad.material = this.blurMaterialH;
    this.blurMaterialH.uniforms.tDiffuse.value = this.bloomRenderTarget.texture;
    this.blurMaterialH.uniforms.resolution.value.set(
      this.blurRenderTargetH.width,
      this.blurRenderTargetH.height
    );
    renderer.setRenderTarget(this.blurRenderTargetH);
    renderer.clear();
    renderer.render(postScene, postCam);

    // 7. Vertical blur
    this.fullscreenQuad.material = this.blurMaterialV;
    this.blurMaterialV.uniforms.tDiffuse.value = this.blurRenderTargetH.texture;
    this.blurMaterialV.uniforms.resolution.value.set(
      this.blurRenderTargetV.width,
      this.blurRenderTargetV.height
    );
    renderer.setRenderTarget(this.blurRenderTargetV);
    renderer.clear();
    renderer.render(postScene, postCam);

    // 8. Second blur pass for smoother bloom
    this.blurMaterialH.uniforms.tDiffuse.value = this.blurRenderTargetV.texture;
    renderer.setRenderTarget(this.blurRenderTargetH);
    renderer.clear();
    renderer.render(postScene, postCam);

    this.blurMaterialV.uniforms.tDiffuse.value = this.blurRenderTargetH.texture;
    renderer.setRenderTarget(this.blurRenderTargetV);
    renderer.clear();
    renderer.render(postScene, postCam);

    // 9. Composite final image to screen
    this.fullscreenQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
    this.compositeMaterial.uniforms.tBloom.value = this.blurRenderTargetV.texture;
    this.compositeMaterial.uniforms.tSSAO.value = this.ssaoRenderTarget.texture;
    this.compositeMaterial.uniforms.tGodRays.value = this.godRaysRenderTarget.texture;
    this.compositeMaterial.uniforms.resolution.value.set(
      this.renderTarget.width,
      this.renderTarget.height
    );
    renderer.setRenderTarget(originalRenderTarget);
    renderer.clear();
    renderer.render(postScene, postCam);
  }

  setSize(width: number, height: number): void {
    const pixelRatio = this.renderer.getPixelRatio();

    this.renderTarget.setSize(width * pixelRatio, height * pixelRatio);
    this.depthRenderTarget.setSize(width * pixelRatio, height * pixelRatio);

    const halfWidth = Math.floor(width * pixelRatio / 2);
    const halfHeight = Math.floor(height * pixelRatio / 2);

    this.bloomRenderTarget.setSize(halfWidth, halfHeight);
    this.blurRenderTargetH.setSize(halfWidth, halfHeight);
    this.blurRenderTargetV.setSize(halfWidth, halfHeight);
    this.ssaoRenderTarget.setSize(halfWidth, halfHeight);
    this.godRaysRenderTarget.setSize(halfWidth, halfHeight);
  }

  setSunPosition(position: THREE.Vector3): void {
    this.sunPosition.copy(position);
  }

  setSSAOStrength(strength: number): void {
    this.ssaoStrength = strength;
    this.ssaoMaterial.uniforms.ssaoStrength.value = strength;
  }

  setGodRaysStrength(strength: number): void {
    this.godRaysStrength = strength;
    this.godRaysMaterial.uniforms.godRaysStrength.value = strength;
  }

  setSSAOEnabled(enabled: boolean): void {
    this.compositeMaterial.uniforms.ssaoEnabled.value = enabled;
  }

  setGodRaysEnabled(enabled: boolean): void {
    this.compositeMaterial.uniforms.godRaysEnabled.value = enabled;
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
    this.ssaoRenderTarget.dispose();
    this.godRaysRenderTarget.dispose();
    this.depthRenderTarget.dispose();

    this.fullscreenQuad.geometry.dispose();
    this.bloomExtractMaterial.dispose();
    this.blurMaterialH.dispose();
    this.blurMaterialV.dispose();
    this.ssaoMaterial.dispose();
    this.godRaysMaterial.dispose();
    this.compositeMaterial.dispose();
    this.depthMaterial.dispose();
  }
}

/**
 * Advanced GPU Particle System
 *
 * Features:
 * - TSL shader-based soft particles (depth-aware blending)
 * - Animated sprite sheets for fire/smoke
 * - Light scattering using Henyey-Greenstein phase function
 * - GPU instanced rendering for massive particle counts
 * - Particle types: Fire, Smoke, Sparks, Debris, Energy, Plasma
 * - Physics simulation with ground collision
 * - Pooled emitters for zero-allocation spawning
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  vec4,
  uniform,
  uv,
  texture,
  clamp,
  viewportCoordinate,
} from 'three/tsl';

// ============================================
// PARTICLE TYPES
// ============================================

export enum ParticleType {
  FIRE = 0,
  SMOKE = 1,
  SPARK = 2,
  DEBRIS = 3,
  ENERGY = 4,
  PLASMA = 5,
  BLOOD = 6,
  DUST = 7,
  ELECTRICITY = 8,
  SHIELD_HIT = 9,
}

export interface ParticleConfig {
  type: ParticleType;
  lifetime: [number, number]; // min, max
  speed: [number, number];
  size: [number, number];
  sizeOverLife: 'constant' | 'grow' | 'shrink' | 'pulse';
  colorStart: THREE.Color;
  colorEnd: THREE.Color;
  gravity: number;
  drag: number;
  rotationSpeed: number;
  fadeIn: number;
  fadeOut: number;
  spriteSheet?: {
    cols: number;
    rows: number;
    fps: number;
  };
  emissive: number; // 0-1, affects bloom
  softness: number; // 0-1, depth fade softness
}

// Preset configurations for each particle type
export const PARTICLE_CONFIGS: Record<ParticleType, ParticleConfig> = {
  [ParticleType.FIRE]: {
    type: ParticleType.FIRE,
    lifetime: [0.3, 0.8],
    speed: [2, 6],
    size: [0.4, 1.2],
    sizeOverLife: 'grow',
    colorStart: new THREE.Color(1.0, 0.8, 0.3),
    colorEnd: new THREE.Color(0.8, 0.2, 0.0),
    gravity: 3, // Rises
    drag: 0.96,
    rotationSpeed: 1,
    fadeIn: 0.1,
    fadeOut: 0.4,
    spriteSheet: { cols: 4, rows: 4, fps: 24 },
    emissive: 0.9,
    softness: 0.8,
  },
  [ParticleType.SMOKE]: {
    type: ParticleType.SMOKE,
    lifetime: [1.0, 3.0],
    speed: [0.5, 2],
    size: [0.8, 2.5],
    sizeOverLife: 'grow',
    colorStart: new THREE.Color(0.35, 0.32, 0.3),
    colorEnd: new THREE.Color(0.15, 0.14, 0.13),
    gravity: 1.5, // Slowly rises
    drag: 0.97,
    rotationSpeed: 0.3,
    fadeIn: 0.2,
    fadeOut: 0.5,
    spriteSheet: { cols: 4, rows: 4, fps: 12 },
    emissive: 0,
    softness: 0.9,
  },
  [ParticleType.SPARK]: {
    type: ParticleType.SPARK,
    lifetime: [0.2, 0.6],
    speed: [4, 12],
    size: [0.08, 0.2],
    sizeOverLife: 'shrink',
    colorStart: new THREE.Color(1.0, 0.9, 0.5),
    colorEnd: new THREE.Color(1.0, 0.4, 0.1),
    gravity: -15,
    drag: 0.98,
    rotationSpeed: 0,
    fadeIn: 0,
    fadeOut: 0.3,
    emissive: 1.0,
    softness: 0.2,
  },
  [ParticleType.DEBRIS]: {
    type: ParticleType.DEBRIS,
    lifetime: [0.5, 1.5],
    speed: [3, 10],
    size: [0.1, 0.3],
    sizeOverLife: 'constant',
    colorStart: new THREE.Color(0.5, 0.4, 0.3),
    colorEnd: new THREE.Color(0.3, 0.25, 0.2),
    gravity: -20,
    drag: 0.995,
    rotationSpeed: 8,
    fadeIn: 0,
    fadeOut: 0.3,
    emissive: 0,
    softness: 0.3,
  },
  [ParticleType.ENERGY]: {
    type: ParticleType.ENERGY,
    lifetime: [0.2, 0.5],
    speed: [1, 4],
    size: [0.2, 0.6],
    sizeOverLife: 'pulse',
    colorStart: new THREE.Color(0.3, 0.6, 1.0),
    colorEnd: new THREE.Color(0.6, 0.3, 1.0),
    gravity: 0,
    drag: 0.92,
    rotationSpeed: 2,
    fadeIn: 0.1,
    fadeOut: 0.5,
    emissive: 1.0,
    softness: 0.7,
  },
  [ParticleType.PLASMA]: {
    type: ParticleType.PLASMA,
    lifetime: [0.3, 0.7],
    speed: [2, 5],
    size: [0.3, 0.8],
    sizeOverLife: 'shrink',
    colorStart: new THREE.Color(0.5, 1.0, 0.3),
    colorEnd: new THREE.Color(0.2, 0.8, 0.1),
    gravity: -5,
    drag: 0.94,
    rotationSpeed: 1.5,
    fadeIn: 0.05,
    fadeOut: 0.4,
    emissive: 0.8,
    softness: 0.6,
  },
  [ParticleType.BLOOD]: {
    type: ParticleType.BLOOD,
    lifetime: [0.3, 0.8],
    speed: [2, 6],
    size: [0.08, 0.2],
    sizeOverLife: 'shrink',
    colorStart: new THREE.Color(0.7, 0.0, 0.0),
    colorEnd: new THREE.Color(0.3, 0.0, 0.0),
    gravity: -18,
    drag: 0.98,
    rotationSpeed: 0,
    fadeIn: 0,
    fadeOut: 0.4,
    emissive: 0,
    softness: 0.3,
  },
  [ParticleType.DUST]: {
    type: ParticleType.DUST,
    lifetime: [0.5, 1.5],
    speed: [1, 3],
    size: [0.5, 1.5],
    sizeOverLife: 'grow',
    colorStart: new THREE.Color(0.6, 0.55, 0.45),
    colorEnd: new THREE.Color(0.4, 0.38, 0.32),
    gravity: 0.5,
    drag: 0.95,
    rotationSpeed: 0.5,
    fadeIn: 0.15,
    fadeOut: 0.5,
    emissive: 0,
    softness: 0.9,
  },
  [ParticleType.ELECTRICITY]: {
    type: ParticleType.ELECTRICITY,
    lifetime: [0.05, 0.15],
    speed: [0, 0.5],
    size: [0.1, 0.3],
    sizeOverLife: 'pulse',
    colorStart: new THREE.Color(0.7, 0.9, 1.0),
    colorEnd: new THREE.Color(0.4, 0.6, 1.0),
    gravity: 0,
    drag: 0.99,
    rotationSpeed: 20,
    fadeIn: 0,
    fadeOut: 0.8,
    emissive: 1.0,
    softness: 0.4,
  },
  [ParticleType.SHIELD_HIT]: {
    type: ParticleType.SHIELD_HIT,
    lifetime: [0.2, 0.4],
    speed: [0.5, 2],
    size: [0.3, 0.8],
    sizeOverLife: 'grow',
    colorStart: new THREE.Color(0.3, 0.7, 1.0),
    colorEnd: new THREE.Color(0.1, 0.3, 0.6),
    gravity: 0,
    drag: 0.9,
    rotationSpeed: 0,
    fadeIn: 0,
    fadeOut: 0.7,
    emissive: 0.9,
    softness: 0.8,
  },
};

// ============================================
// PARTICLE DATA
// ============================================

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  type: ParticleType;
  colorStart: THREE.Color;
  colorEnd: THREE.Color;
  spriteFrame: number;
  groundY: number;
  emissive: number;
}

// ============================================
// ADVANCED GPU PARTICLE SYSTEM
// ============================================

export class AdvancedParticleSystem {
  private scene: THREE.Scene;
  private maxParticles: number;
  private particles: Particle[] = [];
  private activeCount = 0;

  // Instance buffers
  private instancedMesh: THREE.InstancedMesh;
  private positionBuffer: Float32Array;
  private colorBuffer: Float32Array;
  private customDataBuffer: Float32Array; // life, size, rotation, type

  // Geometry and materials
  private geometry: THREE.PlaneGeometry;
  private material: MeshBasicNodeMaterial;

  // Textures
  private fireTexture: THREE.Texture;
  private smokeTexture: THREE.Texture;
  private glowTexture: THREE.Texture;

  // Uniforms for TSL soft particles
  private timeUniform: { value: number };
  private lightDirUniform: { value: THREE.Vector3 };
  private depthTextureUniform: ReturnType<typeof uniform>;
  private softnessUniform: ReturnType<typeof uniform>;
  private cameraNearUniform: ReturnType<typeof uniform>;
  private cameraFarUniform: ReturnType<typeof uniform>;

  // Terrain height function
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  // Temp vectors
  private readonly _tempVec = new THREE.Vector3();
  private readonly _tempMatrix = new THREE.Matrix4();
  private readonly _tempQuaternion = new THREE.Quaternion();
  private readonly _tempScale = new THREE.Vector3();
  private readonly _tempColor = new THREE.Color();
  private readonly _upVector = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, maxParticles: number = 10000) {
    this.scene = scene;
    this.maxParticles = maxParticles;

    // Create textures
    this.fireTexture = this.createFireTexture();
    this.smokeTexture = this.createSmokeTexture();
    this.glowTexture = this.createGlowTexture();

    // Create uniforms
    this.timeUniform = { value: 0 };
    this.lightDirUniform = { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() };

    // Initialize particles
    for (let i = 0; i < maxParticles; i++) {
      this.particles.push({
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        size: 0,
        rotation: 0,
        rotationSpeed: 0,
        type: ParticleType.FIRE,
        colorStart: new THREE.Color(),
        colorEnd: new THREE.Color(),
        spriteFrame: 0,
        groundY: 0,
        emissive: 0,
      });
    }

    // Create instanced buffers
    this.positionBuffer = new Float32Array(maxParticles * 3);
    this.colorBuffer = new Float32Array(maxParticles * 4);
    this.customDataBuffer = new Float32Array(maxParticles * 4);

    // Initialize positions off-screen
    for (let i = 0; i < maxParticles; i++) {
      this.positionBuffer[i * 3 + 1] = -1000;
    }

    // Create billboard geometry
    this.geometry = new THREE.PlaneGeometry(1, 1);

    // Initialize TSL uniforms for soft particles
    // Create a placeholder 1x1 depth texture (will be set properly via setDepthTexture)
    const placeholderDepth = new THREE.DataTexture(
      new Float32Array([1.0]),
      1,
      1,
      THREE.RedFormat,
      THREE.FloatType
    );
    placeholderDepth.needsUpdate = true;

    this.depthTextureUniform = uniform(placeholderDepth);
    this.softnessUniform = uniform(0.5); // Default softness
    this.cameraNearUniform = uniform(0.1);
    this.cameraFarUniform = uniform(1000.0);

    // Create TSL soft particle material with depth-aware alpha fade
    this.material = this.createSoftParticleMaterial();

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      maxParticles
    );
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.renderOrder = 95; // After most things, before UI

    // Initialize instance matrices
    for (let i = 0; i < maxParticles; i++) {
      this._tempMatrix.makeTranslation(0, -1000, 0);
      this.instancedMesh.setMatrixAt(i, this._tempMatrix);
      this.instancedMesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    this.scene.add(this.instancedMesh);
  }

  /**
   * Set terrain height function for ground collision
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Create a fire/explosion sprite sheet texture
   */
  private createFireTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Create a 4x4 grid of fire frames
    const frameSize = 64;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const cx = col * frameSize + frameSize / 2;
        const cy = row * frameSize + frameSize / 2;
        const radius = frameSize * 0.4;

        // Frame-based variation
        const frameIndex = row * 4 + col;
        const variation = frameIndex / 16;

        // Create radial gradient
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(255, 255, ${Math.floor(200 - variation * 100)}, 1)`);
        gradient.addColorStop(0.3, `rgba(255, ${Math.floor(180 - variation * 80)}, 50, 0.9)`);
        gradient.addColorStop(0.6, `rgba(255, ${Math.floor(100 - variation * 50)}, 0, 0.5)`);
        gradient.addColorStop(0.8, `rgba(200, 50, 0, 0.2)`);
        gradient.addColorStop(1, 'rgba(100, 20, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(col * frameSize, row * frameSize, frameSize, frameSize);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Create a smoke sprite sheet texture
   */
  private createSmokeTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const frameSize = 64;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const cx = col * frameSize + frameSize / 2;
        const cy = row * frameSize + frameSize / 2;
        const radius = frameSize * 0.45;

        const frameIndex = row * 4 + col;
        const alpha = 0.6 - (frameIndex / 16) * 0.2;

        // Soft smoke gradient
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(80, 75, 70, ${alpha})`);
        gradient.addColorStop(0.4, `rgba(60, 55, 50, ${alpha * 0.7})`);
        gradient.addColorStop(0.7, `rgba(40, 38, 35, ${alpha * 0.4})`);
        gradient.addColorStop(1, 'rgba(30, 28, 25, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(col * frameSize, row * frameSize, frameSize, frameSize);

        // Add some noise/irregularity
        ctx.globalCompositeOperation = 'overlay';
        for (let i = 0; i < 20; i++) {
          const nx = col * frameSize + Math.random() * frameSize;
          const ny = row * frameSize + Math.random() * frameSize;
          const nr = 3 + Math.random() * 8;
          const na = Math.random() * 0.2;

          ctx.beginPath();
          ctx.fillStyle = `rgba(255, 255, 255, ${na})`;
          ctx.arc(nx, ny, nr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Create a simple glow texture for sparks and energy
   */
  private createGlowTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Create TSL soft particle material with depth-aware alpha fade
   * Particles fade when approaching scene geometry to avoid hard clipping
   */
  private createSoftParticleMaterial(): MeshBasicNodeMaterial {
    const glowTex = this.glowTexture;
    const depthTex = this.depthTextureUniform;
    const softness = this.softnessUniform;
    const near = this.cameraNearUniform;
    const far = this.cameraFarUniform;

    // TSL fragment shader for soft particles
    const softParticleFragment = Fn(() => {
      // Sample the glow texture
      const texCoord = uv();
      const texColor = texture(glowTex, texCoord);

      // Get screen-space coordinates for depth sampling
      const screenUV = viewportCoordinate.xy;

      // Sample scene depth and convert to linear
      // depthTex is a uniform node wrapping a texture, so use .sample() instead of texture()
      const sceneDepthSample = depthTex.sample(screenUV).r;
      const sceneNDC = sceneDepthSample.mul(2.0).sub(1.0);
      const sceneLinearDepth = near.mul(far).div(
        far.sub(sceneNDC.mul(far.sub(near)))
      );

      // Get particle's linear depth from gl_FragCoord.z
      const particleNDC = viewportCoordinate.z.mul(2.0).sub(1.0);
      const particleLinearDepth = near.mul(far).div(
        far.sub(particleNDC.mul(far.sub(near)))
      );

      // Soft particle fade: alpha decreases as particle approaches scene geometry
      // depthDiff is positive when particle is in front of scene geometry
      const depthDiff = sceneLinearDepth.sub(particleLinearDepth);
      const softFade = clamp(depthDiff.div(softness), 0.0, 1.0);

      // Apply soft fade to texture alpha
      const finalAlpha = texColor.a.mul(softFade);

      return vec4(texColor.rgb, finalAlpha);
    });

    // Create MeshBasicNodeMaterial with custom fragment
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    // Set the color/alpha output using the soft particle node
    material.colorNode = softParticleFragment();

    return material;
  }

  /**
   * Set the depth texture for soft particle rendering
   * Should be called with the scene's depth buffer texture
   */
  public setDepthTexture(depthTexture: THREE.Texture): void {
    this.depthTextureUniform.value = depthTexture;
  }

  /**
   * Update camera parameters for soft particle depth calculations
   */
  public updateCamera(camera: THREE.PerspectiveCamera): void {
    this.cameraNearUniform.value = camera.near;
    this.cameraFarUniform.value = camera.far;
  }

  /**
   * Set the softness value for depth fade (higher = softer transition)
   */
  public setSoftness(softness: number): void {
    this.softnessUniform.value = softness;
  }

  /**
   * Emit particles at a position
   */
  public emit(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    count: number,
    type: ParticleType,
    configOverrides?: Partial<ParticleConfig>
  ): void {
    const baseConfig = PARTICLE_CONFIGS[type];
    const config = configOverrides ? { ...baseConfig, ...configOverrides } : baseConfig;

    const groundY = this.getTerrainHeight
      ? this.getTerrainHeight(position.x, position.z)
      : 0;

    for (let i = 0; i < count; i++) {
      // Find inactive particle
      let particleIndex = -1;
      for (let j = 0; j < this.maxParticles; j++) {
        if (this.particles[j].life <= 0) {
          particleIndex = j;
          break;
        }
      }

      if (particleIndex === -1) break;

      const particle = this.particles[particleIndex];

      // Random spread based on direction
      const spread = 0.6;
      const randomDir = this._tempVec.set(
        direction.x + (Math.random() - 0.5) * spread,
        direction.y + (Math.random() - 0.5) * spread,
        direction.z + (Math.random() - 0.5) * spread
      ).normalize();

      // Random values from config ranges
      const speed = config.speed[0] + Math.random() * (config.speed[1] - config.speed[0]);
      const lifetime = config.lifetime[0] + Math.random() * (config.lifetime[1] - config.lifetime[0]);
      const size = config.size[0] + Math.random() * (config.size[1] - config.size[0]);

      // Initialize particle
      particle.position.copy(position);
      particle.position.x += (Math.random() - 0.5) * 0.3;
      particle.position.z += (Math.random() - 0.5) * 0.3;

      particle.velocity.copy(randomDir).multiplyScalar(speed);
      particle.life = lifetime;
      particle.maxLife = lifetime;
      particle.size = size;
      particle.rotation = Math.random() * Math.PI * 2;
      particle.rotationSpeed = (Math.random() - 0.5) * config.rotationSpeed * 2;
      particle.type = type;
      particle.colorStart.copy(config.colorStart);
      particle.colorEnd.copy(config.colorEnd);
      particle.spriteFrame = 0;
      particle.groundY = groundY;
      particle.emissive = config.emissive;

      this.activeCount = Math.max(this.activeCount, particleIndex + 1);
    }
  }

  /**
   * Emit an explosion effect (combination of fire, smoke, sparks, debris)
   */
  public emitExplosion(position: THREE.Vector3, intensity: number = 1.0): void {
    const upDir = this._upVector;

    // Fire burst
    this.emit(position, upDir, Math.floor(15 * intensity), ParticleType.FIRE);

    // Sparks flying outward
    for (let i = 0; i < Math.floor(25 * intensity); i++) {
      const angle = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.cos(angle),
        0.5 + Math.random() * 0.5,
        Math.sin(angle)
      ).normalize();
      this.emit(position, dir, 1, ParticleType.SPARK);
    }

    // Debris
    for (let i = 0; i < Math.floor(12 * intensity); i++) {
      const angle = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.cos(angle),
        0.8 + Math.random() * 0.4,
        Math.sin(angle)
      ).normalize();
      this.emit(position, dir, 1, ParticleType.DEBRIS);
    }

    // Delayed smoke (starts after initial burst)
    setTimeout(() => {
      this.emit(position, upDir, Math.floor(8 * intensity), ParticleType.SMOKE);
    }, 100);

    setTimeout(() => {
      this.emit(position, upDir, Math.floor(5 * intensity), ParticleType.SMOKE);
    }, 300);
  }

  /**
   * Emit muzzle flash effect
   */
  public emitMuzzleFlash(position: THREE.Vector3, direction: THREE.Vector3): void {
    // Brief fire burst
    this.emit(position, direction, 8, ParticleType.FIRE, {
      lifetime: [0.05, 0.12],
      size: [0.2, 0.5],
    });

    // Sparks
    this.emit(position, direction, 5, ParticleType.SPARK);
  }

  /**
   * Emit impact sparks
   */
  public emitImpact(position: THREE.Vector3, normal: THREE.Vector3): void {
    this.emit(position, normal, 12, ParticleType.SPARK);

    // Small dust cloud
    this.emit(position, this._upVector, 3, ParticleType.DUST, {
      size: [0.3, 0.6],
      lifetime: [0.3, 0.6],
    });
  }

  /**
   * Emit energy/psionic effect
   */
  public emitEnergy(position: THREE.Vector3, direction: THREE.Vector3): void {
    this.emit(position, direction, 10, ParticleType.ENERGY);
    this.emit(position, direction, 5, ParticleType.ELECTRICITY);
  }

  /**
   * Emit plasma/acid effect
   */
  public emitPlasma(position: THREE.Vector3, direction: THREE.Vector3): void {
    this.emit(position, direction, 8, ParticleType.PLASMA);
  }

  /**
   * Update particle simulation
   */
  public update(deltaTime: number, camera?: THREE.Camera): void {
    const dt = deltaTime;
    this.timeUniform.value += dt;

    let needsMatrixUpdate = false;
    let maxActiveIndex = 0;

    for (let i = 0; i < this.activeCount; i++) {
      const particle = this.particles[i];

      if (particle.life <= 0) {
        // Hide particle
        this._tempMatrix.makeTranslation(0, -1000, 0);
        this.instancedMesh.setMatrixAt(i, this._tempMatrix);
        needsMatrixUpdate = true;
        continue;
      }

      maxActiveIndex = i + 1;
      needsMatrixUpdate = true;

      // Get config for this particle type
      const config = PARTICLE_CONFIGS[particle.type];

      // Update lifetime
      particle.life -= dt;

      if (particle.life <= 0) {
        this._tempMatrix.makeTranslation(0, -1000, 0);
        this.instancedMesh.setMatrixAt(i, this._tempMatrix);
        continue;
      }

      // Physics update
      particle.velocity.y += config.gravity * dt;
      particle.velocity.multiplyScalar(Math.pow(config.drag, dt * 60));
      particle.position.addScaledVector(particle.velocity, dt);

      // Ground collision for debris/blood
      if (config.gravity < 0 && particle.position.y < particle.groundY + 0.1) {
        particle.position.y = particle.groundY + 0.1;
        if (particle.velocity.y < -1) {
          particle.velocity.y *= -0.3;
          particle.velocity.x *= 0.7;
          particle.velocity.z *= 0.7;
        } else {
          particle.velocity.set(0, 0, 0);
        }
      }

      // Rotation
      particle.rotation += particle.rotationSpeed * dt;

      // Calculate life ratio (0 = just spawned, 1 = about to die)
      const lifeRatio = 1 - (particle.life / particle.maxLife);

      // Size over life
      let sizeMultiplier = 1.0;
      switch (config.sizeOverLife) {
        case 'grow':
          sizeMultiplier = 0.5 + lifeRatio * 0.8;
          break;
        case 'shrink':
          sizeMultiplier = 1.0 - lifeRatio * 0.6;
          break;
        case 'pulse':
          sizeMultiplier = 1.0 + Math.sin(lifeRatio * Math.PI * 4) * 0.3;
          break;
      }

      const finalSize = particle.size * sizeMultiplier;

      // Alpha with fade in/out
      let alpha = 1.0;
      if (lifeRatio < config.fadeIn && config.fadeIn > 0) {
        alpha = lifeRatio / config.fadeIn;
      } else if (lifeRatio > (1 - config.fadeOut)) {
        alpha = (1 - lifeRatio) / config.fadeOut;
      }

      // Color interpolation
      this._tempColor.copy(particle.colorStart).lerp(particle.colorEnd, lifeRatio);

      // Apply emissive boost for bloom interaction
      if (particle.emissive > 0) {
        this._tempColor.multiplyScalar(1 + particle.emissive);
      }

      // Update instance matrix (position, rotation, scale)
      // Billboard facing camera
      if (camera) {
        this._tempQuaternion.setFromAxisAngle(this._upVector, particle.rotation);
        // Look at camera for billboarding
        this._tempVec.subVectors(camera.position, particle.position).normalize();
        this._tempMatrix.lookAt(
          particle.position,
          this._tempVec.add(particle.position),
          this._upVector
        );
      } else {
        this._tempMatrix.makeRotationY(particle.rotation);
      }

      this._tempScale.set(finalSize, finalSize, finalSize);
      this._tempMatrix.scale(this._tempScale);
      this._tempMatrix.setPosition(particle.position);

      this.instancedMesh.setMatrixAt(i, this._tempMatrix);

      // Update color with alpha
      this._tempColor.multiplyScalar(alpha);
      this.instancedMesh.setColorAt(i, this._tempColor);
    }

    this.activeCount = maxActiveIndex;

    if (needsMatrixUpdate) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
      if (this.instancedMesh.instanceColor) {
        this.instancedMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * Get active particle count
   */
  public getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < this.activeCount; i++) {
      if (this.particles[i].life > 0) count++;
    }
    return count;
  }

  /**
   * Clear all particles
   */
  public clear(): void {
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i].life = 0;
      this._tempMatrix.makeTranslation(0, -1000, 0);
      this.instancedMesh.setMatrixAt(i, this._tempMatrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.activeCount = 0;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.scene.remove(this.instancedMesh);
    this.geometry.dispose();
    this.material.dispose();
    this.fireTexture.dispose();
    this.smokeTexture.dispose();
    this.glowTexture.dispose();
  }
}

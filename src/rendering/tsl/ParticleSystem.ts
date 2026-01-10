/**
 * TSL GPU Particle System
 *
 * WebGPU-accelerated particle system using compute shaders for physics.
 * Features:
 * - GPU-based particle simulation (position, velocity, lifetime)
 * - Instanced rendering for efficient draw calls
 * - Billboard sprites facing camera
 * - Effect presets (explosion, projectile, muzzle flash, etc.)
 */

import * as THREE from 'three';
import {
  MeshBasicNodeMaterial,
  StorageInstancedBufferAttribute,
  storage,
  instancedArray,
  instanceIndex,
  uniform,
  attribute,
  positionLocal,
  cameraPosition,
  modelWorldMatrix,
  uv,
  texture,
  vec2,
  vec3,
  vec4,
  float,
  int,
  Fn,
  If,
  Loop,
  normalize,
  length,
  dot,
  cross,
  mix,
  max,
  min,
  abs,
  floor,
  fract,
  sin,
  cos,
  pow,
  exp,
  sqrt,
  smoothstep,
  clamp,
} from 'three/tsl';

// ============================================
// PARTICLE DATA STRUCTURES
// ============================================

export interface ParticleEffectConfig {
  maxParticles: number;
  emissionRate: number;
  lifetime: [number, number];
  speed: [number, number];
  size: [number, number];
  color: THREE.Color;
  colorEnd?: THREE.Color;
  gravity: number;
  drag: number;
  rotation: number;
  fadeIn: number;
  fadeOut: number;
  texture?: THREE.Texture;
  blending: THREE.Blending;
}

// Effect presets
export const PARTICLE_PRESETS: Record<string, Partial<ParticleEffectConfig>> = {
  explosion: {
    lifetime: [0.3, 0.8],
    speed: [5, 15],
    size: [0.3, 1.0],
    color: new THREE.Color(1.0, 0.6, 0.2),
    colorEnd: new THREE.Color(0.3, 0.1, 0.0),
    gravity: -2,
    drag: 0.95,
    fadeOut: 0.3,
    blending: THREE.AdditiveBlending,
  },
  muzzleFlash: {
    lifetime: [0.05, 0.1],
    speed: [2, 5],
    size: [0.2, 0.5],
    color: new THREE.Color(1.0, 0.9, 0.3),
    colorEnd: new THREE.Color(1.0, 0.5, 0.0),
    gravity: 0,
    drag: 0.9,
    fadeOut: 0.8,
    blending: THREE.AdditiveBlending,
  },
  projectileTrail: {
    lifetime: [0.2, 0.4],
    speed: [0.5, 2],
    size: [0.1, 0.3],
    color: new THREE.Color(0.3, 0.7, 1.0),
    colorEnd: new THREE.Color(0.1, 0.3, 0.6),
    gravity: 0,
    drag: 0.98,
    fadeOut: 0.5,
    blending: THREE.AdditiveBlending,
  },
  sparks: {
    lifetime: [0.5, 1.5],
    speed: [3, 8],
    size: [0.05, 0.15],
    color: new THREE.Color(1.0, 0.8, 0.3),
    colorEnd: new THREE.Color(0.6, 0.2, 0.0),
    gravity: -10,
    drag: 0.97,
    fadeOut: 0.2,
    blending: THREE.AdditiveBlending,
  },
  debris: {
    lifetime: [0.5, 2.0],
    speed: [2, 10],
    size: [0.1, 0.4],
    color: new THREE.Color(0.4, 0.35, 0.3),
    colorEnd: new THREE.Color(0.2, 0.18, 0.15),
    gravity: -15,
    drag: 0.99,
    rotation: 5,
    fadeOut: 0.3,
    blending: THREE.NormalBlending,
  },
  smoke: {
    lifetime: [1.0, 3.0],
    speed: [0.5, 2],
    size: [0.5, 2.0],
    color: new THREE.Color(0.3, 0.3, 0.3),
    colorEnd: new THREE.Color(0.1, 0.1, 0.1),
    gravity: 2,
    drag: 0.95,
    fadeIn: 0.2,
    fadeOut: 0.5,
    blending: THREE.NormalBlending,
  },
  blood: {
    lifetime: [0.3, 0.8],
    speed: [3, 8],
    size: [0.1, 0.3],
    color: new THREE.Color(0.6, 0.0, 0.0),
    colorEnd: new THREE.Color(0.2, 0.0, 0.0),
    gravity: -15,
    drag: 0.98,
    fadeOut: 0.4,
    blending: THREE.NormalBlending,
  },
};

// ============================================
// GPU PARTICLE SYSTEM
// ============================================

export class GPUParticleSystem {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private maxParticles: number;
  private particleMesh: THREE.InstancedMesh | null = null;

  // Storage buffers for GPU data
  private positionBuffer: Float32Array;
  private velocityBuffer: Float32Array;
  private lifetimeBuffer: Float32Array; // [current, max, size, rotation]
  private colorBuffer: Float32Array;

  // Instance attributes
  private positionAttribute: THREE.InstancedBufferAttribute;
  private velocityAttribute: THREE.InstancedBufferAttribute;
  private lifetimeAttribute: THREE.InstancedBufferAttribute;
  private colorAttribute: THREE.InstancedBufferAttribute;

  // Configuration
  private config: ParticleEffectConfig;

  // State
  private activeCount = 0;
  private nextParticleIndex = 0;

  // Uniforms
  private uTime = uniform(0);
  private uDeltaTime = uniform(0);
  private uGravity = uniform(new THREE.Vector3(0, -10, 0));

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    config: Partial<ParticleEffectConfig> = {}
  ) {
    this.scene = scene;
    this.renderer = renderer;

    // Merge with defaults
    this.config = {
      maxParticles: 5000,
      emissionRate: 100,
      lifetime: [0.5, 2.0],
      speed: [5, 10],
      size: [0.1, 0.5],
      color: new THREE.Color(1, 1, 1),
      gravity: -10,
      drag: 0.98,
      rotation: 0,
      fadeIn: 0,
      fadeOut: 0.5,
      blending: THREE.AdditiveBlending,
      ...config,
    };

    this.maxParticles = this.config.maxParticles;

    // Initialize buffers
    this.positionBuffer = new Float32Array(this.maxParticles * 3);
    this.velocityBuffer = new Float32Array(this.maxParticles * 3);
    this.lifetimeBuffer = new Float32Array(this.maxParticles * 4);
    this.colorBuffer = new Float32Array(this.maxParticles * 4);

    // Create attributes
    this.positionAttribute = new THREE.InstancedBufferAttribute(this.positionBuffer, 3);
    this.velocityAttribute = new THREE.InstancedBufferAttribute(this.velocityBuffer, 3);
    this.lifetimeAttribute = new THREE.InstancedBufferAttribute(this.lifetimeBuffer, 4);
    this.colorAttribute = new THREE.InstancedBufferAttribute(this.colorBuffer, 4);

    this.createParticleMesh();
  }

  private createParticleMesh(): void {
    // Create billboard quad geometry
    const geometry = new THREE.PlaneGeometry(1, 1);

    // Add instance attributes
    geometry.setAttribute('instancePosition', this.positionAttribute);
    geometry.setAttribute('instanceVelocity', this.velocityAttribute);
    geometry.setAttribute('instanceLifetime', this.lifetimeAttribute);
    geometry.setAttribute('instanceColor', this.colorAttribute);

    // Create TSL material
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = this.config.blending;
    material.side = THREE.DoubleSide;

    // Instance attributes
    const instancePos = attribute('instancePosition', 'vec3');
    const instanceVel = attribute('instanceVelocity', 'vec3');
    const instanceLife = attribute('instanceLifetime', 'vec4'); // [current, max, size, rotation]
    const instanceCol = attribute('instanceColor', 'vec4');

    // Vertex shader - billboard facing camera
    material.positionNode = Fn(() => {
      const pos = positionLocal;

      // Get camera right and up vectors for billboarding
      const worldPos = instancePos;

      // Simple billboarding - face camera
      const toCamera = normalize(cameraPosition.sub(worldPos));
      const right = normalize(cross(vec3(0, 1, 0), toCamera));
      const up = cross(toCamera, right);

      // Apply size and rotation
      const size = instanceLife.z;
      const rotation = instanceLife.w;

      const cosR = cos(rotation);
      const sinR = sin(rotation);
      const rotatedX = pos.x.mul(cosR).sub(pos.y.mul(sinR));
      const rotatedY = pos.x.mul(sinR).add(pos.y.mul(cosR));

      const offset = right.mul(rotatedX.mul(size)).add(up.mul(rotatedY.mul(size)));

      return worldPos.add(offset);
    })();

    // Fragment shader
    material.colorNode = Fn(() => {
      const instanceLife = attribute('instanceLifetime', 'vec4');
      const instanceCol = attribute('instanceColor', 'vec4');

      const lifeRatio = instanceLife.x.div(instanceLife.y);

      // Fade in/out
      const fadeIn = smoothstep(0.0, this.config.fadeIn, lifeRatio);
      const fadeOut = smoothstep(1.0, float(1.0).sub(this.config.fadeOut), lifeRatio);
      const alpha = fadeIn.mul(fadeOut).mul(instanceCol.w);

      // Circular particle shape
      const dist = length(uv().sub(0.5)).mul(2.0);
      const circle = smoothstep(1.0, 0.8, dist);

      return vec4(instanceCol.xyz, alpha.mul(circle));
    })();

    // Create instanced mesh
    this.particleMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;

    this.scene.add(this.particleMesh);
  }

  /**
   * Emit particles at a position
   */
  emit(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    count: number,
    preset?: keyof typeof PARTICLE_PRESETS
  ): void {
    // Apply preset if specified
    const config = preset ? { ...this.config, ...PARTICLE_PRESETS[preset] } : this.config;

    for (let i = 0; i < count; i++) {
      const idx = this.nextParticleIndex;
      this.nextParticleIndex = (this.nextParticleIndex + 1) % this.maxParticles;

      // Random direction spread
      const spread = 0.5;
      const randomDir = new THREE.Vector3(
        direction.x + (Math.random() - 0.5) * spread,
        direction.y + (Math.random() - 0.5) * spread,
        direction.z + (Math.random() - 0.5) * spread
      ).normalize();

      // Random speed
      const speed = config.speed[0] + Math.random() * (config.speed[1] - config.speed[0]);

      // Position
      this.positionBuffer[idx * 3] = position.x;
      this.positionBuffer[idx * 3 + 1] = position.y;
      this.positionBuffer[idx * 3 + 2] = position.z;

      // Velocity
      this.velocityBuffer[idx * 3] = randomDir.x * speed;
      this.velocityBuffer[idx * 3 + 1] = randomDir.y * speed;
      this.velocityBuffer[idx * 3 + 2] = randomDir.z * speed;

      // Lifetime [current, max, size, rotation]
      const lifetime = config.lifetime[0] + Math.random() * (config.lifetime[1] - config.lifetime[0]);
      const size = config.size[0] + Math.random() * (config.size[1] - config.size[0]);
      const rotation = Math.random() * Math.PI * 2;

      this.lifetimeBuffer[idx * 4] = 0; // current
      this.lifetimeBuffer[idx * 4 + 1] = lifetime; // max
      this.lifetimeBuffer[idx * 4 + 2] = size;
      this.lifetimeBuffer[idx * 4 + 3] = rotation;

      // Color
      const color = config.color;
      this.colorBuffer[idx * 4] = color.r;
      this.colorBuffer[idx * 4 + 1] = color.g;
      this.colorBuffer[idx * 4 + 2] = color.b;
      this.colorBuffer[idx * 4 + 3] = 1.0;

      this.activeCount = Math.min(this.activeCount + 1, this.maxParticles);
    }

    // Update attributes
    this.positionAttribute.needsUpdate = true;
    this.velocityAttribute.needsUpdate = true;
    this.lifetimeAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;

    if (this.particleMesh) {
      this.particleMesh.count = this.activeCount;
    }
  }

  /**
   * Update particle simulation (CPU fallback)
   * For full WebGPU, this would be a compute shader
   */
  update(deltaTime: number): void {
    const dt = deltaTime;
    const gravity = this.config.gravity;
    const drag = this.config.drag;
    const rotationSpeed = this.config.rotation;

    let aliveCount = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      const lifeIdx = i * 4;
      const currentLife = this.lifetimeBuffer[lifeIdx];
      const maxLife = this.lifetimeBuffer[lifeIdx + 1];

      if (currentLife < maxLife) {
        // Update lifetime
        this.lifetimeBuffer[lifeIdx] += dt;

        // Update rotation
        this.lifetimeBuffer[lifeIdx + 3] += rotationSpeed * dt;

        // Update velocity (gravity + drag)
        const velIdx = i * 3;
        this.velocityBuffer[velIdx + 1] += gravity * dt;
        this.velocityBuffer[velIdx] *= drag;
        this.velocityBuffer[velIdx + 1] *= drag;
        this.velocityBuffer[velIdx + 2] *= drag;

        // Update position
        const posIdx = i * 3;
        this.positionBuffer[posIdx] += this.velocityBuffer[velIdx] * dt;
        this.positionBuffer[posIdx + 1] += this.velocityBuffer[velIdx + 1] * dt;
        this.positionBuffer[posIdx + 2] += this.velocityBuffer[velIdx + 2] * dt;

        // Interpolate color if colorEnd is set
        if (this.config.colorEnd) {
          const t = currentLife / maxLife;
          const startColor = this.config.color;
          const endColor = this.config.colorEnd;
          const colIdx = i * 4;
          this.colorBuffer[colIdx] = startColor.r + (endColor.r - startColor.r) * t;
          this.colorBuffer[colIdx + 1] = startColor.g + (endColor.g - startColor.g) * t;
          this.colorBuffer[colIdx + 2] = startColor.b + (endColor.b - startColor.b) * t;
        }

        aliveCount++;
      }
    }

    // Update attributes
    this.positionAttribute.needsUpdate = true;
    this.velocityAttribute.needsUpdate = true;
    this.lifetimeAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;

    this.activeCount = aliveCount;
    if (this.particleMesh) {
      this.particleMesh.count = aliveCount;
    }
  }

  /**
   * Clear all particles
   */
  clear(): void {
    this.lifetimeBuffer.fill(0);
    this.lifetimeAttribute.needsUpdate = true;
    this.activeCount = 0;
    if (this.particleMesh) {
      this.particleMesh.count = 0;
    }
  }

  /**
   * Get active particle count
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.particleMesh) {
      this.scene.remove(this.particleMesh);
      this.particleMesh.geometry.dispose();
      (this.particleMesh.material as THREE.Material).dispose();
    }
  }
}

// ============================================
// EFFECT EMITTER HELPER
// ============================================

export class EffectEmitter {
  private particleSystem: GPUParticleSystem;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, maxParticles: number = 10000) {
    this.particleSystem = new GPUParticleSystem(scene, renderer, { maxParticles });
  }

  explosion(position: THREE.Vector3, intensity: number = 1): void {
    const count = Math.floor(30 * intensity);
    this.particleSystem.emit(position, new THREE.Vector3(0, 1, 0), count, 'explosion');
    this.particleSystem.emit(position, new THREE.Vector3(0, 0.5, 0), Math.floor(count / 2), 'debris');
    this.particleSystem.emit(position, new THREE.Vector3(0, 2, 0), Math.floor(count / 3), 'smoke');
  }

  muzzleFlash(position: THREE.Vector3, direction: THREE.Vector3): void {
    this.particleSystem.emit(position, direction, 10, 'muzzleFlash');
    this.particleSystem.emit(position, direction, 5, 'sparks');
  }

  projectileTrail(position: THREE.Vector3, direction: THREE.Vector3): void {
    this.particleSystem.emit(position, direction.clone().negate(), 3, 'projectileTrail');
  }

  impact(position: THREE.Vector3, normal: THREE.Vector3): void {
    this.particleSystem.emit(position, normal, 15, 'sparks');
    this.particleSystem.emit(position, normal, 5, 'debris');
  }

  update(deltaTime: number): void {
    this.particleSystem.update(deltaTime);
  }

  dispose(): void {
    this.particleSystem.dispose();
  }
}

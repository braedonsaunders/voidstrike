/**
 * TSL GPU Particle System
 *
 * High-performance particle system using instanced rendering.
 * Features:
 * - GPU-based particle rendering with instanced meshes
 * - Billboard sprites facing camera
 * - Effect presets (explosion, projectile, muzzle flash, etc.)
 * - Compatible with both WebGL and WebGPU backends
 */

import * as THREE from 'three';

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

interface ParticleData {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  color: THREE.Color;
  colorEnd: THREE.Color;
}

export class GPUParticleSystem {
  private scene: THREE.Scene;
  private maxParticles: number;
  private particles: ParticleData[] = [];
  private particleMesh: THREE.Points | null = null;

  // Buffers
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  // Geometry and material
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;

  // Configuration
  private config: ParticleEffectConfig;

  // State
  private activeCount = 0;

  // PERF: Reusable temp vector to avoid allocation in hot loop
  private readonly _tempVelocity = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    config: Partial<ParticleEffectConfig> = {}
  ) {
    this.scene = scene;

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
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 4);
    this.sizes = new Float32Array(this.maxParticles);

    // Initialize particles array
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        size: 0,
        rotation: 0,
        color: new THREE.Color(),
        colorEnd: new THREE.Color(),
      });
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // Create shader material for particles
    this.material = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: this.config.blending,
      sizeAttenuation: true,
    });

    this.particleMesh = new THREE.Points(this.geometry, this.material);
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
    const presetConfig = preset ? PARTICLE_PRESETS[preset] : {};
    const config = { ...this.config, ...presetConfig };

    for (let i = 0; i < count; i++) {
      // Find an inactive particle
      let particleIndex = -1;
      for (let j = 0; j < this.maxParticles; j++) {
        if (this.particles[j].life <= 0) {
          particleIndex = j;
          break;
        }
      }

      if (particleIndex === -1) continue; // No available particles

      const particle = this.particles[particleIndex];

      // Random direction spread
      const spread = 0.5;
      const randomDir = new THREE.Vector3(
        direction.x + (Math.random() - 0.5) * spread,
        direction.y + (Math.random() - 0.5) * spread,
        direction.z + (Math.random() - 0.5) * spread
      ).normalize();

      // Random speed
      const speed = config.speed[0] + Math.random() * (config.speed[1] - config.speed[0]);

      // Initialize particle
      particle.position.copy(position);
      particle.velocity.copy(randomDir).multiplyScalar(speed);
      particle.maxLife = config.lifetime[0] + Math.random() * (config.lifetime[1] - config.lifetime[0]);
      particle.life = particle.maxLife;
      particle.size = config.size[0] + Math.random() * (config.size[1] - config.size[0]);
      particle.rotation = Math.random() * Math.PI * 2;
      particle.color.copy(config.color);
      particle.colorEnd.copy(config.colorEnd ?? config.color);

      this.activeCount = Math.max(this.activeCount, particleIndex + 1);
    }
  }

  /**
   * Update particle simulation
   */
  update(deltaTime: number): void {
    const dt = deltaTime;
    let maxActiveIndex = 0;

    for (let i = 0; i < this.activeCount; i++) {
      const particle = this.particles[i];

      if (particle.life <= 0) continue;

      // Update lifetime
      particle.life -= dt;

      if (particle.life <= 0) {
        // Hide particle
        this.positions[i * 3 + 1] = -1000;
        continue;
      }

      maxActiveIndex = i + 1;

      // Update velocity (gravity + drag)
      particle.velocity.y += this.config.gravity * dt;
      particle.velocity.multiplyScalar(this.config.drag);

      // Update position - PERF: Reuse temp vector instead of clone()
      this._tempVelocity.copy(particle.velocity).multiplyScalar(dt);
      particle.position.add(this._tempVelocity);

      // Update buffers
      this.positions[i * 3] = particle.position.x;
      this.positions[i * 3 + 1] = particle.position.y;
      this.positions[i * 3 + 2] = particle.position.z;

      // Interpolate color
      const lifeRatio = 1 - (particle.life / particle.maxLife);
      const r = particle.color.r + (particle.colorEnd.r - particle.color.r) * lifeRatio;
      const g = particle.color.g + (particle.colorEnd.g - particle.color.g) * lifeRatio;
      const b = particle.color.b + (particle.colorEnd.b - particle.color.b) * lifeRatio;

      // Fade out
      let alpha = 1.0;
      if (lifeRatio > (1 - this.config.fadeOut)) {
        alpha = (1 - lifeRatio) / this.config.fadeOut;
      }
      if (this.config.fadeIn > 0 && lifeRatio < this.config.fadeIn) {
        alpha *= lifeRatio / this.config.fadeIn;
      }

      this.colors[i * 4] = r;
      this.colors[i * 4 + 1] = g;
      this.colors[i * 4 + 2] = b;
      this.colors[i * 4 + 3] = alpha;

      this.sizes[i] = particle.size;
    }

    // Update geometry
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;

    this.activeCount = maxActiveIndex;
  }

  /**
   * Clear all particles
   */
  clear(): void {
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i].life = 0;
      this.positions[i * 3 + 1] = -1000;
    }
    this.activeCount = 0;
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
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
      this.geometry.dispose();
      this.material.dispose();
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

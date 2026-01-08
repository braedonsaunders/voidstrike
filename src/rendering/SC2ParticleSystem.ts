import * as THREE from 'three';

/**
 * SC2-LEVEL PARTICLE SYSTEM
 *
 * High-performance GPU-based particle system for:
 * - Projectile trails with glow
 * - Explosion particles with debris
 * - Muzzle flash effects
 * - Impact sparks
 * - Death explosions
 * - Ability effects
 */

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  maxLife: number;
  rotation: number;
  rotationSpeed: number;
  gravity: number;
  drag: number;
  fadeIn: number;
  scaleOverLife: number; // 1 = constant, >1 = grow, <1 = shrink
}

interface ParticleEmitter {
  id: string;
  position: THREE.Vector3;
  particles: Particle[];
  emitRate: number;
  emitAccumulator: number;
  lifetime: number;
  age: number;
  config: EmitterConfig;
}

interface EmitterConfig {
  particleCount: number;
  particleLife: number;
  particleLifeVariance: number;
  speed: number;
  speedVariance: number;
  size: number;
  sizeVariance: number;
  color: THREE.Color;
  colorEnd?: THREE.Color;
  direction?: THREE.Vector3;
  spread: number; // Cone angle in radians
  gravity: number;
  drag: number;
  fadeIn: number;
  scaleOverLife: number;
  blending: THREE.Blending;
}

// Preset effect configurations
const EFFECT_PRESETS = {
  // Gauss rifle / marine fire
  gaussRifle: {
    particleCount: 8,
    particleLife: 0.15,
    particleLifeVariance: 0.05,
    speed: 30,
    speedVariance: 5,
    size: 0.08,
    sizeVariance: 0.02,
    color: new THREE.Color(0xffcc00),
    colorEnd: new THREE.Color(0xff6600),
    spread: 0.1,
    gravity: 0,
    drag: 0,
    fadeIn: 0,
    scaleOverLife: 0.5,
    blending: THREE.AdditiveBlending,
  },

  // Siege tank shell
  tankShell: {
    particleCount: 12,
    particleLife: 0.3,
    particleLifeVariance: 0.1,
    speed: 25,
    speedVariance: 3,
    size: 0.15,
    sizeVariance: 0.03,
    color: new THREE.Color(0xff8800),
    colorEnd: new THREE.Color(0xff2200),
    spread: 0.05,
    gravity: 2,
    drag: 0.1,
    fadeIn: 0,
    scaleOverLife: 0.3,
    blending: THREE.AdditiveBlending,
  },

  // Explosion
  explosion: {
    particleCount: 50,
    particleLife: 0.6,
    particleLifeVariance: 0.2,
    speed: 8,
    speedVariance: 4,
    size: 0.3,
    sizeVariance: 0.15,
    color: new THREE.Color(0xffaa00),
    colorEnd: new THREE.Color(0x440000),
    spread: Math.PI, // Full sphere
    gravity: -0.5, // Rise slightly
    drag: 0.95,
    fadeIn: 0.1,
    scaleOverLife: 2.0, // Expand
    blending: THREE.AdditiveBlending,
  },

  // Sparks on impact
  impactSparks: {
    particleCount: 20,
    particleLife: 0.4,
    particleLifeVariance: 0.15,
    speed: 6,
    speedVariance: 3,
    size: 0.05,
    sizeVariance: 0.02,
    color: new THREE.Color(0xffff88),
    colorEnd: new THREE.Color(0xff4400),
    spread: Math.PI * 0.6,
    gravity: 8,
    drag: 0.02,
    fadeIn: 0,
    scaleOverLife: 0.3,
    blending: THREE.AdditiveBlending,
  },

  // Death explosion with debris
  deathExplosion: {
    particleCount: 80,
    particleLife: 1.0,
    particleLifeVariance: 0.3,
    speed: 5,
    speedVariance: 3,
    size: 0.2,
    sizeVariance: 0.1,
    color: new THREE.Color(0xff6600),
    colorEnd: new THREE.Color(0x220000),
    spread: Math.PI,
    gravity: 3,
    drag: 0.5,
    fadeIn: 0.05,
    scaleOverLife: 1.5,
    blending: THREE.AdditiveBlending,
  },

  // Debris chunks
  debris: {
    particleCount: 15,
    particleLife: 1.5,
    particleLifeVariance: 0.5,
    speed: 4,
    speedVariance: 2,
    size: 0.15,
    sizeVariance: 0.08,
    color: new THREE.Color(0x444444),
    colorEnd: new THREE.Color(0x222222),
    spread: Math.PI * 0.8,
    gravity: 12,
    drag: 0.1,
    fadeIn: 0,
    scaleOverLife: 0.8,
    blending: THREE.NormalBlending,
  },

  // Smoke trail
  smoke: {
    particleCount: 30,
    particleLife: 1.2,
    particleLifeVariance: 0.3,
    speed: 0.5,
    speedVariance: 0.3,
    size: 0.4,
    sizeVariance: 0.2,
    color: new THREE.Color(0x444444),
    colorEnd: new THREE.Color(0x111111),
    spread: Math.PI * 0.3,
    gravity: -1,
    drag: 0.9,
    fadeIn: 0.2,
    scaleOverLife: 3.0,
    blending: THREE.NormalBlending,
  },

  // Muzzle flash
  muzzleFlash: {
    particleCount: 15,
    particleLife: 0.08,
    particleLifeVariance: 0.02,
    speed: 5,
    speedVariance: 2,
    size: 0.25,
    sizeVariance: 0.1,
    color: new THREE.Color(0xffffcc),
    colorEnd: new THREE.Color(0xff8800),
    spread: Math.PI * 0.4,
    gravity: 0,
    drag: 0,
    fadeIn: 0,
    scaleOverLife: 0.2,
    blending: THREE.AdditiveBlending,
  },

  // Energy beam impact
  energyImpact: {
    particleCount: 25,
    particleLife: 0.3,
    particleLifeVariance: 0.1,
    speed: 4,
    speedVariance: 2,
    size: 0.12,
    sizeVariance: 0.05,
    color: new THREE.Color(0x00aaff),
    colorEnd: new THREE.Color(0x0044ff),
    spread: Math.PI * 0.7,
    gravity: 0,
    drag: 0.8,
    fadeIn: 0,
    scaleOverLife: 1.5,
    blending: THREE.AdditiveBlending,
  },
};

export class SC2ParticleSystem {
  private scene: THREE.Scene;
  private emitters: Map<string, ParticleEmitter> = new Map();

  // GPU instanced mesh for particles
  private particleMesh!: THREE.InstancedMesh;
  private maxParticles = 5000;
  private activeParticles: Particle[] = [];
  private dummy = new THREE.Object3D();
  private colorAttribute!: THREE.InstancedBufferAttribute;

  // Particle texture
  private particleTexture!: THREE.Texture;

  private emitterIdCounter = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createParticleTexture();
    this.createInstancedMesh();
  }

  private createParticleTexture(): void {
    // Create a soft circle texture for particles
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Radial gradient for soft glow
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    this.particleTexture = new THREE.CanvasTexture(canvas);
    this.particleTexture.needsUpdate = true;
  }

  private createInstancedMesh(): void {
    // Use plane geometry for billboard particles
    const geometry = new THREE.PlaneGeometry(1, 1);

    // Custom shader material for particle rendering
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.particleTexture },
      },
      vertexShader: `
        attribute vec3 instanceColor;
        attribute float instanceAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vUv;

        void main() {
          vColor = instanceColor;
          vAlpha = instanceAlpha;
          vUv = uv;

          // Billboard - always face camera
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mvPosition.xy += position.xy * vec2(instanceMatrix[0][0], instanceMatrix[1][1]);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vUv;

        void main() {
          vec4 texColor = texture2D(map, vUv);
          gl_FragColor = vec4(vColor * texColor.rgb, texColor.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particleMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.particleMesh.frustumCulled = false;

    // Create instance attributes for color and alpha
    const colors = new Float32Array(this.maxParticles * 3);
    const alphas = new Float32Array(this.maxParticles);
    this.colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
    const alphaAttribute = new THREE.InstancedBufferAttribute(alphas, 1);

    geometry.setAttribute('instanceColor', this.colorAttribute);
    geometry.setAttribute('instanceAlpha', alphaAttribute);

    // Initially hide all instances
    for (let i = 0; i < this.maxParticles; i++) {
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.particleMesh);
  }

  // Spawn a one-shot effect
  spawnEffect(type: keyof typeof EFFECT_PRESETS, position: THREE.Vector3, direction?: THREE.Vector3): string {
    const config: EmitterConfig = { ...EFFECT_PRESETS[type] };
    if (direction) {
      config.direction = direction.clone().normalize();
    }

    return this.createEmitter(position, config, true);
  }

  // Create continuous emitter
  createEmitter(position: THREE.Vector3, config: EmitterConfig, oneShot = false): string {
    const id = `emitter_${this.emitterIdCounter++}`;

    const emitter: ParticleEmitter = {
      id,
      position: position.clone(),
      particles: [],
      emitRate: oneShot ? config.particleCount * 10 : config.particleCount,
      emitAccumulator: 0,
      lifetime: oneShot ? config.particleLife + config.particleLifeVariance : Infinity,
      age: 0,
      config,
    };

    // For one-shot effects, emit all particles immediately
    if (oneShot) {
      for (let i = 0; i < config.particleCount; i++) {
        this.emitParticle(emitter);
      }
    }

    this.emitters.set(id, emitter);
    return id;
  }

  removeEmitter(id: string): void {
    this.emitters.delete(id);
  }

  private emitParticle(emitter: ParticleEmitter): void {
    if (this.activeParticles.length >= this.maxParticles) return;

    const config = emitter.config;

    // Calculate velocity direction
    let velocity: THREE.Vector3;
    if (config.direction) {
      // Cone emission around direction
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * config.spread;

      const dir = config.direction.clone();
      const perpX = new THREE.Vector3(1, 0, 0);
      if (Math.abs(dir.dot(perpX)) > 0.9) {
        perpX.set(0, 1, 0);
      }
      const perpY = new THREE.Vector3().crossVectors(dir, perpX).normalize();
      perpX.crossVectors(perpY, dir).normalize();

      velocity = dir.clone()
        .multiplyScalar(Math.cos(phi))
        .add(perpX.multiplyScalar(Math.sin(phi) * Math.cos(theta)))
        .add(perpY.multiplyScalar(Math.sin(phi) * Math.sin(theta)));
    } else {
      // Spherical emission
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * config.spread;
      velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      );
    }

    const speed = config.speed + (Math.random() - 0.5) * 2 * config.speedVariance;
    velocity.multiplyScalar(speed);

    const life = config.particleLife + (Math.random() - 0.5) * 2 * config.particleLifeVariance;
    const size = config.size + (Math.random() - 0.5) * 2 * config.sizeVariance;

    const particle: Particle = {
      position: emitter.position.clone(),
      velocity,
      color: config.color.clone(),
      size,
      life,
      maxLife: life,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 4,
      gravity: config.gravity,
      drag: config.drag,
      fadeIn: config.fadeIn,
      scaleOverLife: config.scaleOverLife,
    };

    this.activeParticles.push(particle);
  }

  update(deltaTime: number): void {
    const dt = deltaTime / 1000;

    // Update emitters
    for (const [id, emitter] of this.emitters) {
      emitter.age += dt;

      // Remove expired emitters
      if (emitter.age >= emitter.lifetime) {
        this.emitters.delete(id);
        continue;
      }

      // Continuous emission
      if (emitter.lifetime === Infinity) {
        emitter.emitAccumulator += dt * emitter.emitRate;
        while (emitter.emitAccumulator >= 1) {
          this.emitParticle(emitter);
          emitter.emitAccumulator -= 1;
        }
      }
    }

    // Update particles
    const alphaAttribute = this.particleMesh.geometry.getAttribute('instanceAlpha') as THREE.BufferAttribute;

    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];

      // Update life
      p.life -= dt;
      if (p.life <= 0) {
        // Remove dead particle
        this.activeParticles.splice(i, 1);
        continue;
      }

      // Apply physics
      p.velocity.y -= p.gravity * dt;
      p.velocity.multiplyScalar(1 - p.drag * dt);
      p.position.add(p.velocity.clone().multiplyScalar(dt));

      // Update rotation
      p.rotation += p.rotationSpeed * dt;
    }

    // Update instance matrices and colors
    const colorAttr = this.particleMesh.geometry.getAttribute('instanceColor') as THREE.BufferAttribute;
    const alphaAttr = this.particleMesh.geometry.getAttribute('instanceAlpha') as THREE.BufferAttribute;

    for (let i = 0; i < this.maxParticles; i++) {
      if (i < this.activeParticles.length) {
        const p = this.activeParticles[i];
        const lifeRatio = 1 - p.life / p.maxLife;

        // Position and scale
        this.dummy.position.copy(p.position);

        // Scale over life
        const scale = p.size * (1 + (p.scaleOverLife - 1) * lifeRatio);
        this.dummy.scale.set(scale, scale, scale);

        // Rotation
        this.dummy.rotation.z = p.rotation;

        this.dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummy.matrix);

        // Color interpolation
        colorAttr.setXYZ(i, p.color.r, p.color.g, p.color.b);

        // Alpha with fade in/out
        let alpha = 1;
        if (lifeRatio < p.fadeIn && p.fadeIn > 0) {
          alpha = lifeRatio / p.fadeIn;
        } else if (lifeRatio > 0.7) {
          alpha = 1 - (lifeRatio - 0.7) / 0.3;
        }
        alphaAttr.setX(i, alpha);
      } else {
        // Hide unused particles
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummy.matrix);
        alphaAttr.setX(i, 0);
      }
    }

    this.particleMesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  // Convenience methods for common effects
  spawnMuzzleFlash(position: THREE.Vector3, direction: THREE.Vector3): void {
    this.spawnEffect('muzzleFlash', position, direction);
  }

  spawnProjectileTrail(position: THREE.Vector3, direction: THREE.Vector3, type: 'gauss' | 'tank' = 'gauss'): void {
    const effectType = type === 'tank' ? 'tankShell' : 'gaussRifle';
    this.spawnEffect(effectType, position, direction);
  }

  spawnImpact(position: THREE.Vector3, type: 'normal' | 'energy' = 'normal'): void {
    this.spawnEffect('impactSparks', position);
    if (type === 'energy') {
      this.spawnEffect('energyImpact', position);
    }
  }

  spawnExplosion(position: THREE.Vector3, large = false): void {
    this.spawnEffect('explosion', position);
    if (large) {
      this.spawnEffect('smoke', position);
      this.spawnEffect('debris', position);
    }
  }

  spawnDeathEffect(position: THREE.Vector3, unitSize: number = 1): void {
    this.spawnEffect('deathExplosion', position);
    this.spawnEffect('smoke', position);
    if (unitSize > 1) {
      this.spawnEffect('debris', position);
    }
  }

  dispose(): void {
    this.scene.remove(this.particleMesh);
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    this.particleTexture.dispose();
    this.activeParticles = [];
    this.emitters.clear();
  }
}

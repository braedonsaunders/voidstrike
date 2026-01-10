import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';

interface AttackEffect {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  progress: number;
  duration: number;
  mesh: THREE.Mesh | THREE.Line;
  type: 'projectile' | 'laser' | 'melee';
}

interface HitEffect {
  position: THREE.Vector3;
  progress: number;
  duration: number;
  mesh: THREE.Mesh;
}

interface DamageNumber {
  position: THREE.Vector3;
  damage: number;
  progress: number;
  duration: number;
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
}

interface FocusFireIndicator {
  targetId: number;
  attackerCount: number;
  mesh: THREE.Mesh;
  pulseTime: number;
}

interface ExplosionParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  progress: number;
  duration: number;
}

interface FireEffect {
  entityId: number;
  particles: THREE.Points;
  progress: number;
}

interface MoveIndicator {
  position: THREE.Vector3;
  progress: number;
  duration: number;
  rings: THREE.Mesh[];
}

// PERFORMANCE: Object pools to avoid allocation/deallocation in hot loops
interface MeshPool {
  available: THREE.Mesh[];
  inUse: Set<THREE.Mesh>;
  maxSize: number;
}

const POOL_SIZE = 50;

export class EffectsRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private attackEffects: AttackEffect[] = [];
  private hitEffects: HitEffect[] = [];
  private damageNumbers: DamageNumber[] = [];
  private explosionParticles: ExplosionParticle[] = [];
  private focusFireIndicators: Map<number, FocusFireIndicator> = new Map();
  private targetAttackerCounts: Map<number, Set<number>> = new Map(); // targetId -> Set of attackerIds
  private moveIndicators: MoveIndicator[] = [];

  // PERFORMANCE: Object pools for reusable meshes
  private projectilePool: MeshPool;
  private hitEffectPool: MeshPool;
  private explosionPool: MeshPool;

  // Shared geometries and materials
  // Per threejs-builder skill: create geometries once, don't create in event handlers
  private projectileGeometry: THREE.SphereGeometry;
  private projectileMaterial: THREE.MeshBasicMaterial;
  private laserMaterial: THREE.LineBasicMaterial;
  private hitGeometry: THREE.RingGeometry;
  private hitMaterial: THREE.MeshBasicMaterial;
  private deathGeometry: THREE.RingGeometry;
  private deathMaterial: THREE.MeshBasicMaterial;
  private focusFireGeometry: THREE.RingGeometry;
  private focusFireMaterial: THREE.MeshBasicMaterial;
  private explosionGeometry: THREE.SphereGeometry;
  private explosionMaterial: THREE.MeshBasicMaterial;
  private damageCanvas: HTMLCanvasElement;
  private damageContext: CanvasRenderingContext2D;
  private moveIndicatorGeometry: THREE.RingGeometry;
  private moveIndicatorMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, eventBus: EventBus) {
    this.scene = scene;
    this.eventBus = eventBus;

    // Create shared resources
    this.projectileGeometry = new THREE.SphereGeometry(0.15, 8, 8);
    this.projectileMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.9,
    });

    this.laserMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.8,
    });

    this.hitGeometry = new THREE.RingGeometry(0.2, 0.5, 16);
    this.hitMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Death effect geometry - created once, reused per threejs-builder skill
    this.deathGeometry = new THREE.RingGeometry(0.5, 1.0, 16);
    this.deathMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Focus fire indicator - pulsing ring around targets being attacked by multiple units
    this.focusFireGeometry = new THREE.RingGeometry(0.8, 1.2, 24);
    this.focusFireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Explosion debris particles
    this.explosionGeometry = new THREE.SphereGeometry(0.2, 6, 6);
    this.explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 1,
    });

    // Canvas for damage numbers
    this.damageCanvas = document.createElement('canvas');
    this.damageCanvas.width = 128;
    this.damageCanvas.height = 64;
    this.damageContext = this.damageCanvas.getContext('2d')!;

    // Move command indicator - green ring that shrinks
    this.moveIndicatorGeometry = new THREE.RingGeometry(0.3, 0.6, 16);
    this.moveIndicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Initialize object pools
    this.projectilePool = this.createPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial.clone());
      mesh.visible = false;
      return mesh;
    });

    this.hitEffectPool = this.createPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.hitGeometry, this.hitMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 998; // Render after terrain but before damage numbers
      return mesh;
    });

    this.explosionPool = this.createPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.explosionGeometry, this.explosionMaterial.clone());
      mesh.visible = false;
      return mesh;
    });

    this.setupEventListeners();
  }

  /**
   * Create an object pool with pre-allocated meshes
   */
  private createPool(size: number, factory: () => THREE.Mesh): MeshPool {
    const pool: MeshPool = {
      available: [],
      inUse: new Set(),
      maxSize: size,
    };

    for (let i = 0; i < size; i++) {
      const mesh = factory();
      this.scene.add(mesh);
      pool.available.push(mesh);
    }

    return pool;
  }

  /**
   * Acquire a mesh from the pool
   */
  private acquireFromPool(pool: MeshPool, factory?: () => THREE.Mesh): THREE.Mesh | null {
    if (pool.available.length > 0) {
      const mesh = pool.available.pop()!;
      pool.inUse.add(mesh);
      mesh.visible = true;
      return mesh;
    }

    // Pool exhausted - create new if factory provided and under max
    if (factory && pool.inUse.size < pool.maxSize * 2) {
      const mesh = factory();
      this.scene.add(mesh);
      pool.inUse.add(mesh);
      mesh.visible = true;
      return mesh;
    }

    return null;
  }

  /**
   * Release a mesh back to the pool
   */
  private releaseToPool(pool: MeshPool, mesh: THREE.Mesh): void {
    if (pool.inUse.has(mesh)) {
      pool.inUse.delete(mesh);
      mesh.visible = false;
      mesh.scale.set(1, 1, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      if (pool.available.length < pool.maxSize) {
        pool.available.push(mesh);
      }
    }
  }

  /**
   * Dispose all meshes in a pool
   */
  private disposePool(pool: MeshPool): void {
    for (const mesh of pool.available) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    for (const mesh of pool.inUse) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    pool.available = [];
    pool.inUse.clear();
  }

  private setupEventListeners(): void {
    this.eventBus.on('combat:attack', (data: {
      attackerId?: number;
      targetId?: number;
      attackerPos?: { x: number; y: number };
      targetPos?: { x: number; y: number };
      damage: number;
      damageType: string;
      targetHeight?: number;
    }) => {
      if (data.attackerPos && data.targetPos) {
        this.createAttackEffect(
          new THREE.Vector3(data.attackerPos.x, 0.5, data.attackerPos.y),
          new THREE.Vector3(data.targetPos.x, 0.5, data.targetPos.y),
          data.damageType
        );

        // Create floating damage number ABOVE the target
        // Use targetHeight for buildings, default 2.5 for units
        const damageNumberY = (data.targetHeight && data.targetHeight > 0) ? data.targetHeight + 1.5 : 2.5;
        this.createDamageNumber(
          new THREE.Vector3(data.targetPos.x, damageNumberY, data.targetPos.y),
          data.damage
        );

        // Track focus fire - multiple attackers on same target
        if (data.attackerId !== undefined && data.targetId !== undefined) {
          this.trackFocusFire(data.attackerId, data.targetId, data.targetPos);
        }
      }
    });

    this.eventBus.on('unit:died', (data: {
      entityId?: number;
      position?: { x: number; y: number };
    }) => {
      if (data.position) {
        this.createDeathEffect(new THREE.Vector3(data.position.x, 0.1, data.position.y));
      }
      // Clear focus fire tracking for dead unit
      if (data.entityId !== undefined) {
        this.clearFocusFire(data.entityId);
      }
    });

    // Clear attacker from focus fire when they die or stop attacking
    this.eventBus.on('unit:stopAttack', (data: { attackerId?: number; targetId?: number }) => {
      if (data.attackerId !== undefined && data.targetId !== undefined) {
        this.removeAttackerFromTarget(data.attackerId, data.targetId);
      }
    });

    // Building destroyed - create big explosion
    this.eventBus.on('building:destroyed', (data: {
      entityId: number;
      playerId: string;
      buildingType: string;
      position: { x: number; y: number };
    }) => {
      this.createBuildingExplosion(
        new THREE.Vector3(data.position.x, 0, data.position.y),
        data.buildingType
      );
      // Clear any focus fire on this building
      this.clearFocusFire(data.entityId);
    });

    // Move command - show indicator on ground
    this.eventBus.on('command:move', (data: {
      entityIds: number[];
      targetPosition?: { x: number; y: number };
    }) => {
      if (data.entityIds.length > 0 && data.targetPosition) {
        this.createMoveIndicator(
          new THREE.Vector3(data.targetPosition.x, 0.15, data.targetPosition.y)
        );
      }
    });
  }

  public createAttackEffect(
    start: THREE.Vector3,
    end: THREE.Vector3,
    damageType: string
  ): void {
    if (damageType === 'psionic') {
      this.createLaserEffect(start, end);
    } else {
      this.createProjectileEffect(start, end);
    }
  }

  private createProjectileEffect(start: THREE.Vector3, end: THREE.Vector3): void {
    // PERFORMANCE: Use object pool instead of creating new mesh
    const mesh = this.acquireFromPool(this.projectilePool, () => {
      const m = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial.clone());
      return m;
    });

    if (!mesh) return; // Pool exhausted

    mesh.position.copy(start);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;

    this.attackEffects.push({
      startPos: start.clone(),
      endPos: end.clone(),
      progress: 0,
      duration: 0.2, // 200ms travel time
      mesh,
      type: 'projectile',
    });
  }

  private createLaserEffect(start: THREE.Vector3, end: THREE.Vector3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geometry, this.laserMaterial.clone());
    this.scene.add(line);

    this.attackEffects.push({
      startPos: start.clone(),
      endPos: end.clone(),
      progress: 0,
      duration: 0.1, // 100ms flash
      mesh: line,
      type: 'laser',
    });

    // Also create hit effect at end
    this.createHitEffect(end);
  }

  private createHitEffect(position: THREE.Vector3): void {
    // PERFORMANCE: Use object pool instead of creating new mesh
    const mesh = this.acquireFromPool(this.hitEffectPool, () => {
      const m = new THREE.Mesh(this.hitGeometry, this.hitMaterial.clone());
      m.rotation.x = -Math.PI / 2;
      return m;
    });

    if (!mesh) return; // Pool exhausted

    mesh.position.copy(position);
    mesh.position.y = 0.1;
    mesh.scale.set(1, 1, 1);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;

    this.hitEffects.push({
      position: position.clone(),
      progress: 0,
      duration: 0.3,
      mesh,
    });
  }

  private createDeathEffect(position: THREE.Vector3): void {
    // Use shared geometry, clone material for independent opacity
    // Per threejs-builder skill: don't create geometry in event handlers
    const mesh = new THREE.Mesh(this.deathGeometry, this.deathMaterial.clone());
    mesh.position.copy(position);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 998; // Render after terrain
    this.scene.add(mesh);

    this.hitEffects.push({
      position: position.clone(),
      progress: 0,
      duration: 0.5,
      mesh,
    });
  }

  /**
   * Create a large explosion effect for building destruction
   * Multiple debris particles + expanding ring + flash
   */
  private createBuildingExplosion(position: THREE.Vector3, buildingType: string): void {
    // Determine explosion size based on building type
    const isLargeBuilding = ['headquarters', 'infantry_bay', 'forge', 'hangar'].includes(buildingType);
    const particleCount = isLargeBuilding ? 20 : 12;
    const explosionRadius = isLargeBuilding ? 4 : 2.5;

    // Create debris particles flying outward - use pool when possible
    for (let i = 0; i < particleCount; i++) {
      // PERFORMANCE: Try to acquire from pool first
      let mesh = this.acquireFromPool(this.explosionPool);

      if (!mesh) {
        // Pool exhausted - create new
        const material = this.explosionMaterial.clone();
        mesh = new THREE.Mesh(this.explosionGeometry, material);
        this.scene.add(mesh);
      }

      // Vary colors between orange, red, and yellow
      const colorChoice = Math.random();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (colorChoice < 0.33) {
        mat.color.setHex(0xff6600); // Orange
      } else if (colorChoice < 0.66) {
        mat.color.setHex(0xff2200); // Red-orange
      } else {
        mat.color.setHex(0xffaa00); // Yellow-orange
      }
      mat.opacity = 1;

      mesh.position.copy(position);
      mesh.position.y = 0.5 + Math.random() * 1.5; // Start at various heights
      mesh.scale.setScalar(0.3 + Math.random() * 0.5);

      // Random outward velocity
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      const upSpeed = 2 + Math.random() * 4;

      this.explosionParticles.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          upSpeed,
          Math.sin(angle) * speed
        ),
        progress: 0,
        duration: 0.8 + Math.random() * 0.4,
      });
    }

    // Create expanding shockwave ring on ground
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.5, explosionRadius, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff4400,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
    );
    ringMesh.position.copy(position);
    ringMesh.position.y = 0.1;
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.renderOrder = 998;
    this.scene.add(ringMesh);

    this.hitEffects.push({
      position: position.clone(),
      progress: 0,
      duration: 0.6,
      mesh: ringMesh,
    });

    // Create bright flash at center
    const flashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(explosionRadius * 0.5, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffff88,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      })
    );
    flashMesh.position.copy(position);
    flashMesh.position.y = 1;
    flashMesh.renderOrder = 998;
    this.scene.add(flashMesh);

    this.hitEffects.push({
      position: position.clone(),
      progress: 0,
      duration: 0.3,
      mesh: flashMesh,
    });
  }

  private createDamageNumber(position: THREE.Vector3, damage: number): void {
    // PERFORMANCE: Limit max active damage numbers to prevent GPU texture spam
    // During heavy combat, this prevents creating hundreds of textures
    const MAX_DAMAGE_NUMBERS = 15;
    if (this.damageNumbers.length >= MAX_DAMAGE_NUMBERS) {
      // Remove oldest damage number to make room
      const oldest = this.damageNumbers.shift();
      if (oldest) {
        this.scene.remove(oldest.sprite);
        (oldest.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (oldest.sprite.material as THREE.SpriteMaterial).dispose();
      }
    }

    // Draw damage text to canvas
    this.damageContext.clearRect(0, 0, 128, 64);
    this.damageContext.font = 'bold 32px Arial';
    this.damageContext.textAlign = 'center';
    this.damageContext.textBaseline = 'middle';

    // Yellow text with black outline for visibility
    this.damageContext.strokeStyle = '#000000';
    this.damageContext.lineWidth = 4;
    this.damageContext.strokeText(Math.round(damage).toString(), 64, 32);
    this.damageContext.fillStyle = '#ffff00';
    this.damageContext.fillText(Math.round(damage).toString(), 64, 32);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(this.damageCanvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(1.5, 0.75, 1);
    sprite.renderOrder = 999; // Render after terrain and other 3D objects
    this.scene.add(sprite);

    this.damageNumbers.push({
      position: position.clone(),
      damage,
      progress: 0,
      duration: 0.7, // PERFORMANCE: Reduced from 1.0s to 0.7s to cycle faster
      sprite,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        2.0,
        (Math.random() - 0.5) * 0.5
      ),
    });
  }

  /**
   * Create an animated move indicator on the ground
   * Shows 3 concentric rings that shrink and fade
   */
  private createMoveIndicator(position: THREE.Vector3): void {
    const rings: THREE.Mesh[] = [];

    // Create 3 concentric rings
    for (let i = 0; i < 3; i++) {
      const ringGeometry = new THREE.RingGeometry(0.4 + i * 0.5, 0.5 + i * 0.5, 16);
      const material = this.moveIndicatorMaterial.clone();
      material.opacity = 0.9 - i * 0.2;

      const ring = new THREE.Mesh(ringGeometry, material);
      ring.position.copy(position);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 996; // Render after terrain
      this.scene.add(ring);
      rings.push(ring);
    }

    this.moveIndicators.push({
      position: position.clone(),
      progress: 0,
      duration: 0.5, // Fast animation
      rings,
    });
  }

  private trackFocusFire(attackerId: number, targetId: number, targetPos: { x: number; y: number }): void {
    // Get or create the set of attackers for this target
    let attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) {
      attackers = new Set();
      this.targetAttackerCounts.set(targetId, attackers);
    }

    // Add this attacker
    attackers.add(attackerId);

    // If 2+ attackers, show/update focus fire indicator
    if (attackers.size >= 2) {
      let indicator = this.focusFireIndicators.get(targetId);

      if (!indicator) {
        // Create new indicator
        const mesh = new THREE.Mesh(this.focusFireGeometry, this.focusFireMaterial.clone());
        mesh.position.set(targetPos.x, 0.15, targetPos.y);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 997; // Render after terrain
        this.scene.add(mesh);

        indicator = {
          targetId,
          attackerCount: attackers.size,
          mesh,
          pulseTime: 0,
        };
        this.focusFireIndicators.set(targetId, indicator);
      } else {
        // Update existing indicator position
        indicator.mesh.position.set(targetPos.x, 0.15, targetPos.y);
        indicator.attackerCount = attackers.size;
      }
    }
  }

  private clearFocusFire(targetId: number): void {
    // Remove indicator
    const indicator = this.focusFireIndicators.get(targetId);
    if (indicator) {
      this.scene.remove(indicator.mesh);
      (indicator.mesh.material as THREE.Material).dispose();
      this.focusFireIndicators.delete(targetId);
    }

    // Clear attacker tracking
    this.targetAttackerCounts.delete(targetId);
  }

  private removeAttackerFromTarget(attackerId: number, targetId: number): void {
    const attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) return;

    attackers.delete(attackerId);

    // If less than 2 attackers, remove indicator
    if (attackers.size < 2) {
      const indicator = this.focusFireIndicators.get(targetId);
      if (indicator) {
        this.scene.remove(indicator.mesh);
        (indicator.mesh.material as THREE.Material).dispose();
        this.focusFireIndicators.delete(targetId);
      }
    }

    // Clean up empty sets
    if (attackers.size === 0) {
      this.targetAttackerCounts.delete(targetId);
    }
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds

    // Update attack effects
    for (let i = this.attackEffects.length - 1; i >= 0; i--) {
      const effect = this.attackEffects[i];
      effect.progress += dt / effect.duration;

      if (effect.progress >= 1) {
        // Effect complete - return to pool or dispose
        if (effect.type === 'projectile' && effect.mesh instanceof THREE.Mesh) {
          this.releaseToPool(this.projectilePool, effect.mesh);
          // Create hit effect for projectiles
          this.createHitEffect(effect.endPos);
        } else if (effect.mesh instanceof THREE.Line) {
          this.scene.remove(effect.mesh);
          effect.mesh.geometry.dispose();
          (effect.mesh.material as THREE.Material).dispose();
        }

        this.attackEffects.splice(i, 1);
      } else {
        // Update position for projectiles
        if (effect.type === 'projectile' && effect.mesh instanceof THREE.Mesh) {
          effect.mesh.position.lerpVectors(
            effect.startPos,
            effect.endPos,
            effect.progress
          );
        } else if (effect.type === 'laser' && effect.mesh instanceof THREE.Line) {
          // Fade out laser
          const material = effect.mesh.material as THREE.LineBasicMaterial;
          material.opacity = 1 - effect.progress;
        }
      }
    }

    // Update hit effects
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const effect = this.hitEffects[i];
      effect.progress += dt / effect.duration;

      if (effect.progress >= 1) {
        // Effect complete - return to pool if it's a pooled mesh
        if (this.hitEffectPool.inUse.has(effect.mesh)) {
          this.releaseToPool(this.hitEffectPool, effect.mesh);
        } else {
          // Non-pooled mesh (death effects, etc) - dispose
          this.scene.remove(effect.mesh);
          if (effect.mesh.geometry) effect.mesh.geometry.dispose();
          (effect.mesh.material as THREE.Material).dispose();
        }
        this.hitEffects.splice(i, 1);
      } else {
        // Expand and fade
        const scale = 1 + effect.progress * 2;
        effect.mesh.scale.set(scale, scale, 1);
        (effect.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - effect.progress;
      }
    }

    // Update explosion particles (debris flying outward with gravity)
    const gravity = -15;
    for (let i = this.explosionParticles.length - 1; i >= 0; i--) {
      const particle = this.explosionParticles[i];
      particle.progress += dt / particle.duration;

      if (particle.progress >= 1) {
        // Particle expired - return to pool if possible
        if (this.explosionPool.inUse.has(particle.mesh)) {
          this.releaseToPool(this.explosionPool, particle.mesh);
        } else {
          this.scene.remove(particle.mesh);
          (particle.mesh.material as THREE.Material).dispose();
        }
        this.explosionParticles.splice(i, 1);
      } else {
        // Apply velocity and gravity
        particle.velocity.y += gravity * dt;
        particle.mesh.position.x += particle.velocity.x * dt;
        particle.mesh.position.y += particle.velocity.y * dt;
        particle.mesh.position.z += particle.velocity.z * dt;

        // Don't let particles go below ground
        if (particle.mesh.position.y < 0.1) {
          particle.mesh.position.y = 0.1;
          particle.velocity.y = 0;
          particle.velocity.x *= 0.5; // Friction
          particle.velocity.z *= 0.5;
        }

        // Fade out in second half and shrink
        if (particle.progress > 0.5) {
          const fadeProgress = (particle.progress - 0.5) * 2;
          (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - fadeProgress;
          const shrink = 1 - fadeProgress * 0.5;
          particle.mesh.scale.setScalar(shrink * (0.3 + Math.random() * 0.2));
        }
      }
    }

    // Update damage numbers
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dmgNum = this.damageNumbers[i];
      dmgNum.progress += dt / dmgNum.duration;

      if (dmgNum.progress >= 1) {
        // Effect complete
        this.scene.remove(dmgNum.sprite);
        (dmgNum.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (dmgNum.sprite.material as THREE.SpriteMaterial).dispose();
        this.damageNumbers.splice(i, 1);
      } else {
        // Float upward with deceleration and fade out
        const decel = 1 - dmgNum.progress * 0.8;
        dmgNum.sprite.position.x += dmgNum.velocity.x * dt * decel;
        dmgNum.sprite.position.y += dmgNum.velocity.y * dt * decel;
        dmgNum.sprite.position.z += dmgNum.velocity.z * dt * decel;

        // Fade out in second half
        if (dmgNum.progress > 0.5) {
          const fadeProgress = (dmgNum.progress - 0.5) * 2;
          (dmgNum.sprite.material as THREE.SpriteMaterial).opacity = 1 - fadeProgress;
        }

        // Scale up slightly as it rises
        const scale = 1 + dmgNum.progress * 0.3;
        dmgNum.sprite.scale.set(1.5 * scale, 0.75 * scale, 1);
      }
    }

    // Update focus fire indicators (pulsing effect)
    for (const indicator of this.focusFireIndicators.values()) {
      indicator.pulseTime += dt * 4; // Pulse speed
      const pulse = 0.8 + Math.sin(indicator.pulseTime) * 0.2;
      indicator.mesh.scale.set(pulse, pulse, 1);

      // Intensity based on attacker count (more attackers = more opaque)
      const baseOpacity = Math.min(0.4 + indicator.attackerCount * 0.15, 0.9);
      (indicator.mesh.material as THREE.MeshBasicMaterial).opacity = baseOpacity * pulse;
    }

    // Update move indicators (shrinking rings)
    for (let i = this.moveIndicators.length - 1; i >= 0; i--) {
      const indicator = this.moveIndicators[i];
      indicator.progress += dt / indicator.duration;

      if (indicator.progress >= 1) {
        // Remove all rings
        for (const ring of indicator.rings) {
          this.scene.remove(ring);
          ring.geometry.dispose();
          (ring.material as THREE.Material).dispose();
        }
        this.moveIndicators.splice(i, 1);
      } else {
        // Shrink and fade rings
        for (let j = 0; j < indicator.rings.length; j++) {
          const ring = indicator.rings[j];
          const shrink = 1 - indicator.progress * 0.5;
          ring.scale.set(shrink, shrink, 1);
          const baseOpacity = 0.9 - j * 0.2;
          (ring.material as THREE.MeshBasicMaterial).opacity = baseOpacity * (1 - indicator.progress);
        }
      }
    }
  }

  public dispose(): void {
    // Clean up all effects - release pooled meshes first
    for (const effect of this.attackEffects) {
      if (effect.type === 'projectile' && effect.mesh instanceof THREE.Mesh) {
        this.releaseToPool(this.projectilePool, effect.mesh);
      } else {
        this.scene.remove(effect.mesh);
        if (effect.mesh instanceof THREE.Mesh) {
          (effect.mesh.material as THREE.Material).dispose();
        }
      }
    }
    for (const effect of this.hitEffects) {
      if (this.hitEffectPool.inUse.has(effect.mesh)) {
        this.releaseToPool(this.hitEffectPool, effect.mesh);
      } else {
        this.scene.remove(effect.mesh);
        if (effect.mesh.geometry) effect.mesh.geometry.dispose();
        (effect.mesh.material as THREE.Material).dispose();
      }
    }

    // Clean up explosion particles
    for (const particle of this.explosionParticles) {
      if (this.explosionPool.inUse.has(particle.mesh)) {
        this.releaseToPool(this.explosionPool, particle.mesh);
      } else {
        this.scene.remove(particle.mesh);
        (particle.mesh.material as THREE.Material).dispose();
      }
    }

    // Dispose all pooled meshes
    this.disposePool(this.projectilePool);
    this.disposePool(this.hitEffectPool);
    this.disposePool(this.explosionPool);

    // Clean up damage numbers
    for (const dmgNum of this.damageNumbers) {
      this.scene.remove(dmgNum.sprite);
      (dmgNum.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (dmgNum.sprite.material as THREE.SpriteMaterial).dispose();
    }

    // Clean up focus fire indicators
    for (const indicator of this.focusFireIndicators.values()) {
      this.scene.remove(indicator.mesh);
      (indicator.mesh.material as THREE.Material).dispose();
    }

    // Clean up move indicators
    for (const indicator of this.moveIndicators) {
      for (const ring of indicator.rings) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
      }
    }

    // Dispose shared resources
    this.projectileGeometry.dispose();
    this.projectileMaterial.dispose();
    this.laserMaterial.dispose();
    this.hitGeometry.dispose();
    this.hitMaterial.dispose();
    this.deathGeometry.dispose();
    this.deathMaterial.dispose();
    this.focusFireGeometry.dispose();
    this.focusFireMaterial.dispose();
    this.explosionGeometry.dispose();
    this.explosionMaterial.dispose();
    this.moveIndicatorGeometry.dispose();
    this.moveIndicatorMaterial.dispose();

    this.attackEffects = [];
    this.hitEffects = [];
    this.explosionParticles = [];
    this.damageNumbers = [];
    this.focusFireIndicators.clear();
    this.targetAttackerCounts.clear();
    this.moveIndicators = [];
  }
}

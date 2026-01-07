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

export class EffectsRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private attackEffects: AttackEffect[] = [];
  private hitEffects: HitEffect[] = [];
  private damageNumbers: DamageNumber[] = [];
  private focusFireIndicators: Map<number, FocusFireIndicator> = new Map();
  private targetAttackerCounts: Map<number, Set<number>> = new Map(); // targetId -> Set of attackerIds

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
  private damageCanvas: HTMLCanvasElement;
  private damageContext: CanvasRenderingContext2D;

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
    });

    // Death effect geometry - created once, reused per threejs-builder skill
    this.deathGeometry = new THREE.RingGeometry(0.5, 1.0, 16);
    this.deathMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });

    // Focus fire indicator - pulsing ring around targets being attacked by multiple units
    this.focusFireGeometry = new THREE.RingGeometry(0.8, 1.2, 24);
    this.focusFireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    // Canvas for damage numbers
    this.damageCanvas = document.createElement('canvas');
    this.damageCanvas.width = 128;
    this.damageCanvas.height = 64;
    this.damageContext = this.damageCanvas.getContext('2d')!;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('combat:attack', (data: {
      attackerId?: number;
      targetId?: number;
      attackerPos?: { x: number; y: number };
      targetPos?: { x: number; y: number };
      damage: number;
      damageType: string;
    }) => {
      if (data.attackerPos && data.targetPos) {
        this.createAttackEffect(
          new THREE.Vector3(data.attackerPos.x, 0.5, data.attackerPos.y),
          new THREE.Vector3(data.targetPos.x, 0.5, data.targetPos.y),
          data.damageType
        );

        // Create floating damage number
        this.createDamageNumber(
          new THREE.Vector3(data.targetPos.x, 1.5, data.targetPos.y),
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
    const mesh = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial.clone());
    mesh.position.copy(start);
    this.scene.add(mesh);

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
    const mesh = new THREE.Mesh(this.hitGeometry, this.hitMaterial.clone());
    mesh.position.copy(position);
    mesh.position.y = 0.1;
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);

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
    this.scene.add(mesh);

    this.hitEffects.push({
      position: position.clone(),
      progress: 0,
      duration: 0.5,
      mesh,
    });
  }

  private createDamageNumber(position: THREE.Vector3, damage: number): void {
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
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(1.5, 0.75, 1);
    this.scene.add(sprite);

    this.damageNumbers.push({
      position: position.clone(),
      damage,
      progress: 0,
      duration: 1.0, // 1 second float
      sprite,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.5, // Random horizontal drift
        2.0, // Upward velocity
        (Math.random() - 0.5) * 0.5
      ),
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
        // Effect complete
        this.scene.remove(effect.mesh);
        if (effect.mesh instanceof THREE.Mesh) {
          (effect.mesh.material as THREE.Material).dispose();
        } else if (effect.mesh instanceof THREE.Line) {
          effect.mesh.geometry.dispose();
          (effect.mesh.material as THREE.Material).dispose();
        }

        // Create hit effect for projectiles
        if (effect.type === 'projectile') {
          this.createHitEffect(effect.endPos);
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
        // Effect complete
        this.scene.remove(effect.mesh);
        (effect.mesh.material as THREE.Material).dispose();
        this.hitEffects.splice(i, 1);
      } else {
        // Expand and fade
        const scale = 1 + effect.progress * 2;
        effect.mesh.scale.set(scale, scale, 1);
        (effect.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - effect.progress;
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
  }

  public dispose(): void {
    // Clean up all effects
    for (const effect of this.attackEffects) {
      this.scene.remove(effect.mesh);
      if (effect.mesh instanceof THREE.Mesh) {
        (effect.mesh.material as THREE.Material).dispose();
      }
    }
    for (const effect of this.hitEffects) {
      this.scene.remove(effect.mesh);
      (effect.mesh.material as THREE.Material).dispose();
    }

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

    this.attackEffects = [];
    this.hitEffects = [];
    this.damageNumbers = [];
    this.focusFireIndicators.clear();
    this.targetAttackerCounts.clear();
  }
}

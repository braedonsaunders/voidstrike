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

export class EffectsRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private attackEffects: AttackEffect[] = [];
  private hitEffects: HitEffect[] = [];

  // Shared geometries and materials
  private projectileGeometry: THREE.SphereGeometry;
  private projectileMaterial: THREE.MeshBasicMaterial;
  private laserMaterial: THREE.LineBasicMaterial;
  private hitGeometry: THREE.RingGeometry;
  private hitMaterial: THREE.MeshBasicMaterial;

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

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('combat:attack', (data: {
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
      }
    });

    this.eventBus.on('unit:died', (data: { position?: { x: number; y: number } }) => {
      if (data.position) {
        this.createDeathEffect(new THREE.Vector3(data.position.x, 0.1, data.position.y));
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
    // Create expanding ring effect for death
    const geometry = new THREE.RingGeometry(0.5, 1.0, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
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

    // Dispose shared resources
    this.projectileGeometry.dispose();
    this.projectileMaterial.dispose();
    this.laserMaterial.dispose();
    this.hitGeometry.dispose();
    this.hitMaterial.dispose();

    this.attackEffects = [];
    this.hitEffects = [];
  }
}

import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';

/**
 * StarCraft 2-style combat effects renderer
 * Features:
 * - Screen shake on explosions and impacts
 * - Weapon-specific projectiles with trails
 * - Muzzle flashes
 * - Impact explosions and sparks
 * - Death explosions for mechanical units
 * - Shield hit effects
 */

// Weapon types for different projectile visuals
export enum WeaponType {
  GAUSS_RIFLE = 'gauss_rifle',       // Marine - small yellow tracers
  GRENADE = 'grenade',               // Marauder - blue concussive grenades
  HELLFIRE = 'hellfire',             // Hellion/Hellbat - orange flames
  SIEGE_CANNON = 'siege_cannon',     // Siege Tank - large explosive shell
  MISSILE = 'missile',               // Viking, Battlecruiser - tracking missiles
  LASER = 'laser',                   // Void Ray style - continuous beam
  YAMATO = 'yamato',                 // Battlecruiser - massive energy blast
  SNIPE = 'snipe',                   // Ghost - instant hit trace
}

interface Projectile {
  mesh: THREE.Group;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  progress: number;
  duration: number;
  weaponType: WeaponType;
  trail: THREE.Points | null;
  trailPositions: THREE.Vector3[];
}

interface MuzzleFlash {
  mesh: THREE.PointLight;
  progress: number;
  duration: number;
}

interface Explosion {
  group: THREE.Group;
  progress: number;
  duration: number;
  scale: number;
}

interface ScreenShake {
  intensity: number;
  duration: number;
  progress: number;
}

interface BeamEffect {
  line: THREE.Line;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  progress: number;
  duration: number;
}

export class SC2EffectsRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private camera: THREE.Camera | null = null;
  private originalCameraPosition = new THREE.Vector3();

  private projectiles: Projectile[] = [];
  private muzzleFlashes: MuzzleFlash[] = [];
  private explosions: Explosion[] = [];
  private beamEffects: BeamEffect[] = [];
  private screenShakes: ScreenShake[] = [];

  // Shared geometries
  private bulletGeometry: THREE.SphereGeometry;
  private grenadeGeometry: THREE.SphereGeometry;
  private missileGeometry: THREE.ConeGeometry;
  private shellGeometry: THREE.CylinderGeometry;

  // Shared materials
  private bulletMaterial: THREE.MeshBasicMaterial;
  private grenadeMaterial: THREE.MeshBasicMaterial;
  private missileMaterial: THREE.MeshBasicMaterial;
  private shellMaterial: THREE.MeshBasicMaterial;
  private flameMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, eventBus: EventBus) {
    this.scene = scene;
    this.eventBus = eventBus;

    // Create shared geometries
    this.bulletGeometry = new THREE.SphereGeometry(0.08, 6, 6);
    this.grenadeGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    this.missileGeometry = new THREE.ConeGeometry(0.1, 0.4, 6);
    this.shellGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 6);

    // Create shared materials
    this.bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    this.grenadeMaterial = new THREE.MeshBasicMaterial({ color: 0x4488ff });
    this.missileMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    this.shellMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    this.flameMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.8,
    });

    this.setupEventListeners();
  }

  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.originalCameraPosition.copy(camera.position);
  }

  private setupEventListeners(): void {
    // Enhanced combat attack event
    this.eventBus.on('combat:attack', (data: {
      attackerId?: number;
      targetId?: number;
      attackerPos?: { x: number; y: number };
      targetPos?: { x: number; y: number };
      damage: number;
      damageType: string;
      weaponType?: string;
      isSplash?: boolean;
    }) => {
      if (data.attackerPos && data.targetPos) {
        const weaponType = this.getWeaponType(data.damageType, data.weaponType);

        // Create projectile
        this.createProjectile(
          new THREE.Vector3(data.attackerPos.x, 0.8, data.attackerPos.y),
          new THREE.Vector3(data.targetPos.x, 0.5, data.targetPos.y),
          weaponType
        );

        // Create muzzle flash
        this.createMuzzleFlash(
          new THREE.Vector3(data.attackerPos.x, 0.8, data.attackerPos.y),
          weaponType
        );
      }
    });

    // Projectile impact
    this.eventBus.on('combat:hit', (data: {
      position?: { x: number; y: number };
      damage: number;
      isSplash?: boolean;
      targetType?: string;
    }) => {
      if (data.position) {
        const pos = new THREE.Vector3(data.position.x, 0.3, data.position.y);

        // Create impact explosion
        this.createExplosion(pos, data.isSplash ? 1.5 : 0.8);

        // Screen shake for big hits
        if (data.damage > 30 || data.isSplash) {
          this.addScreenShake(data.isSplash ? 0.3 : 0.15, 0.2);
        }
      }
    });

    // Unit death
    this.eventBus.on('unit:died', (data: {
      entityId?: number;
      position?: { x: number; y: number };
      unitType?: string;
      isMechanical?: boolean;
    }) => {
      if (data.position) {
        const pos = new THREE.Vector3(data.position.x, 0.5, data.position.y);

        // Mechanical units get bigger explosions
        const scale = data.isMechanical ? 2.0 : 1.0;
        this.createDeathExplosion(pos, scale, data.isMechanical ?? false);

        // Screen shake for deaths
        this.addScreenShake(data.isMechanical ? 0.4 : 0.2, 0.3);
      }
    });

    // Shield hit effect
    this.eventBus.on('combat:shieldHit', (data: {
      position?: { x: number; y: number };
      damage: number;
    }) => {
      if (data.position) {
        this.createShieldHitEffect(
          new THREE.Vector3(data.position.x, 1.0, data.position.y)
        );
      }
    });

    // Ability effects (like Yamato cannon)
    this.eventBus.on('ability:fire', (data: {
      abilityId: string;
      startPos?: { x: number; y: number };
      endPos?: { x: number; y: number };
    }) => {
      if (data.startPos && data.endPos) {
        if (data.abilityId === 'yamato_cannon') {
          this.createYamatoBlast(
            new THREE.Vector3(data.startPos.x, 1.5, data.startPos.y),
            new THREE.Vector3(data.endPos.x, 1.0, data.endPos.y)
          );
        }
      }
    });
  }

  private getWeaponType(damageType: string, weaponTypeHint?: string): WeaponType {
    if (weaponTypeHint) {
      return (WeaponType as Record<string, WeaponType>)[weaponTypeHint.toUpperCase()] || WeaponType.GAUSS_RIFLE;
    }

    // Infer from damage type
    switch (damageType) {
      case 'explosive':
        return WeaponType.SIEGE_CANNON;
      case 'concussive':
        return WeaponType.GRENADE;
      case 'psionic':
        return WeaponType.LASER;
      default:
        return WeaponType.GAUSS_RIFLE;
    }
  }

  private createProjectile(
    start: THREE.Vector3,
    end: THREE.Vector3,
    weaponType: WeaponType
  ): void {
    const group = new THREE.Group();
    let duration = 0.2;
    let trail: THREE.Points | null = null;

    switch (weaponType) {
      case WeaponType.GAUSS_RIFLE:
        {
          const bullet = new THREE.Mesh(this.bulletGeometry, this.bulletMaterial.clone());
          group.add(bullet);

          // Add glow
          const glow = new THREE.PointLight(0xffff00, 0.5, 2);
          group.add(glow);

          duration = 0.1;
        }
        break;

      case WeaponType.GRENADE:
        {
          const grenade = new THREE.Mesh(this.grenadeGeometry, this.grenadeMaterial.clone());
          group.add(grenade);

          // Blue glow
          const glow = new THREE.PointLight(0x4488ff, 0.8, 3);
          group.add(glow);

          duration = 0.25;
        }
        break;

      case WeaponType.MISSILE:
        {
          const missile = new THREE.Mesh(this.missileGeometry, this.missileMaterial.clone());
          missile.rotation.x = Math.PI / 2;
          group.add(missile);

          // Engine glow
          const glow = new THREE.PointLight(0xff4400, 1.0, 4);
          glow.position.z = -0.2;
          group.add(glow);

          // Create smoke trail
          trail = this.createSmokeTrail();
          this.scene.add(trail);

          duration = 0.4;
        }
        break;

      case WeaponType.SIEGE_CANNON:
        {
          const shell = new THREE.Mesh(this.shellGeometry, this.shellMaterial.clone());
          shell.rotation.z = Math.PI / 2;
          group.add(shell);

          // Bright muzzle flash color
          const glow = new THREE.PointLight(0xffaa00, 2.0, 6);
          group.add(glow);

          duration = 0.35;
        }
        break;

      case WeaponType.HELLFIRE:
        {
          // Flame effect - multiple particles
          for (let i = 0; i < 5; i++) {
            const flame = new THREE.Mesh(
              new THREE.SphereGeometry(0.15 - i * 0.02, 6, 6),
              this.flameMaterial.clone()
            );
            flame.position.z = -i * 0.1;
            group.add(flame);
          }

          const glow = new THREE.PointLight(0xff4400, 1.5, 5);
          group.add(glow);

          duration = 0.15;
        }
        break;

      default:
        {
          const bullet = new THREE.Mesh(this.bulletGeometry, this.bulletMaterial.clone());
          group.add(bullet);
          duration = 0.15;
        }
    }

    group.position.copy(start);

    // Orient toward target
    const direction = new THREE.Vector3().subVectors(end, start).normalize();
    group.lookAt(end);

    this.scene.add(group);

    this.projectiles.push({
      mesh: group,
      startPos: start.clone(),
      endPos: end.clone(),
      progress: 0,
      duration,
      weaponType,
      trail,
      trailPositions: [start.clone()],
    });
  }

  private createSmokeTrail(): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(30 * 3); // 30 particles
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x888888,
      size: 0.15,
      transparent: true,
      opacity: 0.5,
      sizeAttenuation: true,
    });

    return new THREE.Points(geometry, material);
  }

  private createMuzzleFlash(position: THREE.Vector3, weaponType: WeaponType): void {
    let color = 0xffff00;
    let intensity = 2;
    let distance = 4;
    let duration = 0.05;

    switch (weaponType) {
      case WeaponType.SIEGE_CANNON:
        color = 0xffaa00;
        intensity = 5;
        distance = 8;
        duration = 0.1;
        break;
      case WeaponType.HELLFIRE:
        color = 0xff4400;
        intensity = 3;
        distance = 5;
        duration = 0.08;
        break;
      case WeaponType.GRENADE:
        color = 0x4488ff;
        intensity = 1.5;
        distance = 3;
        duration = 0.06;
        break;
    }

    const light = new THREE.PointLight(color, intensity, distance);
    light.position.copy(position);
    this.scene.add(light);

    this.muzzleFlashes.push({
      mesh: light,
      progress: 0,
      duration,
    });
  }

  private createExplosion(position: THREE.Vector3, scale: number): void {
    const group = new THREE.Group();
    group.position.copy(position);

    // Core flash
    const coreGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 1.0,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.name = 'core';
    group.add(core);

    // Outer explosion
    const outerGeometry = new THREE.SphereGeometry(0.5, 12, 12);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.8,
    });
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    outer.name = 'outer';
    group.add(outer);

    // Spark particles
    const sparkCount = 8;
    for (let i = 0; i < sparkCount; i++) {
      const sparkGeometry = new THREE.SphereGeometry(0.05, 4, 4);
      const sparkMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 1.0,
      });
      const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
      const angle = (i / sparkCount) * Math.PI * 2;
      spark.userData.velocity = new THREE.Vector3(
        Math.cos(angle) * 2,
        Math.random() * 2,
        Math.sin(angle) * 2
      );
      spark.name = `spark_${i}`;
      group.add(spark);
    }

    // Ground ring
    const ringGeometry = new THREE.RingGeometry(0.2, 0.4, 16);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'ring';
    group.add(ring);

    // Light
    const light = new THREE.PointLight(0xff6600, 3, 8);
    light.name = 'light';
    group.add(light);

    group.scale.setScalar(scale);
    this.scene.add(group);

    this.explosions.push({
      group,
      progress: 0,
      duration: 0.4,
      scale,
    });
  }

  private createDeathExplosion(position: THREE.Vector3, scale: number, isMechanical: boolean): void {
    // Create a larger, more dramatic explosion for unit deaths
    const group = new THREE.Group();
    group.position.copy(position);

    // Multiple expanding rings
    for (let i = 0; i < 3; i++) {
      const ringGeometry = new THREE.RingGeometry(0.3 + i * 0.3, 0.5 + i * 0.3, 24);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: isMechanical ? 0xff6600 : 0xff4444,
        transparent: true,
        opacity: 0.8 - i * 0.2,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.userData.delay = i * 0.05;
      ring.name = `deathRing_${i}`;
      group.add(ring);
    }

    // Core fireball
    const coreGeometry = new THREE.SphereGeometry(0.6, 12, 12);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 1.0,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.name = 'deathCore';
    group.add(core);

    // Debris particles (for mechanical)
    if (isMechanical) {
      for (let i = 0; i < 12; i++) {
        const debrisGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const debrisMaterial = new THREE.MeshBasicMaterial({
          color: 0x444444,
          transparent: true,
          opacity: 1.0,
        });
        const debris = new THREE.Mesh(debrisGeometry, debrisMaterial);
        const angle = (i / 12) * Math.PI * 2;
        const upAngle = Math.random() * Math.PI / 3;
        debris.userData.velocity = new THREE.Vector3(
          Math.cos(angle) * Math.cos(upAngle) * 4,
          Math.sin(upAngle) * 4,
          Math.sin(angle) * Math.cos(upAngle) * 4
        );
        debris.userData.rotationSpeed = new THREE.Vector3(
          Math.random() * 10,
          Math.random() * 10,
          Math.random() * 10
        );
        debris.name = `debris_${i}`;
        group.add(debris);
      }
    }

    // Strong light
    const light = new THREE.PointLight(0xff6600, 5, 12);
    light.name = 'deathLight';
    group.add(light);

    group.scale.setScalar(scale);
    this.scene.add(group);

    this.explosions.push({
      group,
      progress: 0,
      duration: 0.6,
      scale,
    });
  }

  private createShieldHitEffect(position: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(position);

    // Blue shield ripple
    const rippleGeometry = new THREE.RingGeometry(0.3, 0.5, 24);
    const rippleMaterial = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const ripple = new THREE.Mesh(rippleGeometry, rippleMaterial);
    ripple.name = 'shieldRipple';
    group.add(ripple);

    // Shield spark
    const sparkGeometry = new THREE.SphereGeometry(0.15, 8, 8);
    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 1.0,
    });
    const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
    spark.name = 'shieldSpark';
    group.add(spark);

    // Blue light
    const light = new THREE.PointLight(0x00aaff, 2, 5);
    light.name = 'shieldLight';
    group.add(light);

    this.scene.add(group);

    this.explosions.push({
      group,
      progress: 0,
      duration: 0.3,
      scale: 1.0,
    });
  }

  private createYamatoBlast(start: THREE.Vector3, end: THREE.Vector3): void {
    // Create a massive energy beam
    const geometry = new THREE.CylinderGeometry(0.3, 0.5, start.distanceTo(end), 12);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.9,
    });
    const beam = new THREE.Mesh(geometry, material);

    // Position and orient beam
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    beam.position.copy(midpoint);
    beam.lookAt(end);
    beam.rotateX(Math.PI / 2);

    const line = beam as unknown as THREE.Line; // Type workaround
    this.scene.add(beam);

    // Massive screen shake
    this.addScreenShake(0.8, 0.5);

    // Create impact explosion
    this.createDeathExplosion(end, 3.0, true);

    this.beamEffects.push({
      line: line,
      startPos: start,
      endPos: end,
      progress: 0,
      duration: 0.3,
    });
  }

  public addScreenShake(intensity: number, duration: number): void {
    this.screenShakes.push({
      intensity,
      duration,
      progress: 0,
    });
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;

    this.updateProjectiles(dt);
    this.updateMuzzleFlashes(dt);
    this.updateExplosions(dt);
    this.updateBeamEffects(dt);
    this.updateScreenShake(dt);
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.progress += dt / proj.duration;

      if (proj.progress >= 1) {
        // Projectile reached target - create impact
        this.scene.remove(proj.mesh);
        proj.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            (child.material as THREE.Material)?.dispose();
          }
        });

        if (proj.trail) {
          this.scene.remove(proj.trail);
          proj.trail.geometry.dispose();
          (proj.trail.material as THREE.Material).dispose();
        }

        // Create impact explosion
        this.createExplosion(proj.endPos, proj.weaponType === WeaponType.SIEGE_CANNON ? 1.5 : 0.8);

        this.projectiles.splice(i, 1);
      } else {
        // Update position with arc for grenades/shells
        const t = proj.progress;
        proj.mesh.position.lerpVectors(proj.startPos, proj.endPos, t);

        // Add arc for projectiles
        if (proj.weaponType === WeaponType.GRENADE || proj.weaponType === WeaponType.SIEGE_CANNON) {
          const arcHeight = proj.startPos.distanceTo(proj.endPos) * 0.2;
          proj.mesh.position.y += Math.sin(t * Math.PI) * arcHeight;
        }

        // Update trail
        if (proj.trail) {
          proj.trailPositions.push(proj.mesh.position.clone());
          if (proj.trailPositions.length > 10) {
            proj.trailPositions.shift();
          }

          const positions = proj.trail.geometry.attributes.position.array as Float32Array;
          for (let j = 0; j < proj.trailPositions.length && j < 10; j++) {
            positions[j * 3] = proj.trailPositions[j].x;
            positions[j * 3 + 1] = proj.trailPositions[j].y;
            positions[j * 3 + 2] = proj.trailPositions[j].z;
          }
          proj.trail.geometry.attributes.position.needsUpdate = true;
        }
      }
    }
  }

  private updateMuzzleFlashes(dt: number): void {
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const flash = this.muzzleFlashes[i];
      flash.progress += dt / flash.duration;

      if (flash.progress >= 1) {
        this.scene.remove(flash.mesh);
        flash.mesh.dispose();
        this.muzzleFlashes.splice(i, 1);
      } else {
        // Fade out
        flash.mesh.intensity *= (1 - flash.progress);
      }
    }
  }

  private updateExplosions(dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.progress += dt / exp.duration;

      if (exp.progress >= 1) {
        this.scene.remove(exp.group);
        exp.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            (child.material as THREE.Material)?.dispose();
          }
          if (child instanceof THREE.PointLight) {
            child.dispose();
          }
        });
        this.explosions.splice(i, 1);
      } else {
        // Animate explosion elements
        const t = exp.progress;

        exp.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshBasicMaterial;

            if (child.name === 'core' || child.name === 'deathCore') {
              // Core expands then fades
              const coreScale = 1 + t * 2;
              child.scale.setScalar(coreScale);
              mat.opacity = 1 - t;
            } else if (child.name === 'outer') {
              // Outer expands faster
              const outerScale = 1 + t * 3;
              child.scale.setScalar(outerScale);
              mat.opacity = 0.8 * (1 - t);
            } else if (child.name.startsWith('spark_') || child.name.startsWith('debris_')) {
              // Sparks/debris fly outward
              const vel = child.userData.velocity as THREE.Vector3;
              if (vel) {
                child.position.add(vel.clone().multiplyScalar(dt));
                vel.y -= 9.8 * dt; // Gravity
              }
              mat.opacity = 1 - t;

              // Rotate debris
              const rotSpeed = child.userData.rotationSpeed as THREE.Vector3;
              if (rotSpeed) {
                child.rotation.x += rotSpeed.x * dt;
                child.rotation.y += rotSpeed.y * dt;
                child.rotation.z += rotSpeed.z * dt;
              }
            } else if (child.name === 'ring' || child.name.startsWith('deathRing_')) {
              // Ring expands outward
              const delay = child.userData.delay || 0;
              const ringT = Math.max(0, t - delay);
              const ringScale = 1 + ringT * 4;
              child.scale.setScalar(ringScale);
              mat.opacity = 0.6 * (1 - ringT);
            } else if (child.name === 'shieldRipple') {
              // Shield ripple expands
              const rippleScale = 1 + t * 3;
              child.scale.setScalar(rippleScale);
              mat.opacity = 0.8 * (1 - t);
            } else if (child.name === 'shieldSpark') {
              mat.opacity = 1 - t;
            }
          } else if (child instanceof THREE.PointLight) {
            // Light fades
            child.intensity *= (1 - t * 0.1);
          }
        });
      }
    }
  }

  private updateBeamEffects(dt: number): void {
    for (let i = this.beamEffects.length - 1; i >= 0; i--) {
      const beam = this.beamEffects[i];
      beam.progress += dt / beam.duration;

      if (beam.progress >= 1) {
        this.scene.remove(beam.line);
        if (beam.line instanceof THREE.Mesh) {
          beam.line.geometry?.dispose();
          (beam.line.material as THREE.Material)?.dispose();
        }
        this.beamEffects.splice(i, 1);
      } else {
        // Fade beam
        if (beam.line instanceof THREE.Mesh) {
          const mat = beam.line.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.9 * (1 - beam.progress);
        }
      }
    }
  }

  private updateScreenShake(dt: number): void {
    if (!this.camera) return;

    let totalShakeX = 0;
    let totalShakeY = 0;

    for (let i = this.screenShakes.length - 1; i >= 0; i--) {
      const shake = this.screenShakes[i];
      shake.progress += dt / shake.duration;

      if (shake.progress >= 1) {
        this.screenShakes.splice(i, 1);
      } else {
        // Decaying shake
        const decay = 1 - shake.progress;
        const shakeAmount = shake.intensity * decay;

        totalShakeX += (Math.random() - 0.5) * 2 * shakeAmount;
        totalShakeY += (Math.random() - 0.5) * 2 * shakeAmount;
      }
    }

    // Apply cumulative shake (camera position is managed by RTSCamera, we offset here)
    this.camera.position.x += totalShakeX;
    this.camera.position.y += totalShakeY;
  }

  public dispose(): void {
    // Clean up all effects
    for (const proj of this.projectiles) {
      this.scene.remove(proj.mesh);
      if (proj.trail) this.scene.remove(proj.trail);
    }
    for (const flash of this.muzzleFlashes) {
      this.scene.remove(flash.mesh);
    }
    for (const exp of this.explosions) {
      this.scene.remove(exp.group);
    }
    for (const beam of this.beamEffects) {
      this.scene.remove(beam.line);
    }

    // Dispose shared geometries
    this.bulletGeometry.dispose();
    this.grenadeGeometry.dispose();
    this.missileGeometry.dispose();
    this.shellGeometry.dispose();

    // Dispose shared materials
    this.bulletMaterial.dispose();
    this.grenadeMaterial.dispose();
    this.missileMaterial.dispose();
    this.shellMaterial.dispose();
    this.flameMaterial.dispose();

    this.projectiles = [];
    this.muzzleFlashes = [];
    this.explosions = [];
    this.beamEffects = [];
    this.screenShakes = [];
  }
}

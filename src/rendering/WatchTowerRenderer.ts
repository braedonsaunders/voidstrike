import * as THREE from 'three';
import { ActiveWatchTower, VisionSystem } from '@/engine/systems/VisionSystem';
import { scheduleGeometryDisposal } from './shared';

/**
 * Renders Xel'naga watch towers with activation particle effects
 * When a unit stands in the tower's radius, it lights up and reveals fog of war
 */
export class WatchTowerRenderer {
  private scene: THREE.Scene;
  private visionSystem: VisionSystem;
  private towerMeshes: Map<number, THREE.Group> = new Map();
  private particleSystems: Map<number, THREE.Points> = new Map();
  private glowLights: Map<number, THREE.PointLight> = new Map();

  constructor(scene: THREE.Scene, visionSystem: VisionSystem) {
    this.scene = scene;
    this.visionSystem = visionSystem;

    // Create tower meshes for all watch towers
    this.createTowers();
  }

  private createTowers(): void {
    const towers = this.visionSystem.getWatchTowers();

    for (const tower of towers) {
      const group = new THREE.Group();
      group.position.set(tower.x, 0, tower.y);

      // Create tower base - stone platform
      const baseGeometry = new THREE.CylinderGeometry(2, 2.5, 0.5, 8);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x555566,
        roughness: 0.8,
        metalness: 0.1,
      });
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      base.position.y = 0.25;
      group.add(base);

      // Create tower pillar
      const pillarGeometry = new THREE.CylinderGeometry(0.4, 0.6, 3, 6);
      const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0x667788,
        roughness: 0.6,
        metalness: 0.3,
      });
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.y = 2;
      group.add(pillar);

      // Create crystal/orb on top
      const crystalGeometry = new THREE.OctahedronGeometry(0.6, 0);
      const crystalMaterial = new THREE.MeshStandardMaterial({
        color: 0x4488ff,
        roughness: 0.2,
        metalness: 0.5,
        emissive: 0x112244,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
      });
      const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);
      crystal.position.y = 4;
      crystal.userData.isCrystal = true;
      group.add(crystal);

      // Create particle system for activation effect
      const particles = this.createParticleSystem(tower);
      particles.visible = false; // Hidden until activated
      group.add(particles);

      // Create point light for glow effect
      const light = new THREE.PointLight(0x4488ff, 0, tower.radius * 2);
      light.position.y = 4;
      group.add(light);

      this.scene.add(group);
      this.towerMeshes.set(tower.id, group);
      this.particleSystems.set(tower.id, particles);
      this.glowLights.set(tower.id, light);
    }
  }

  private createParticleSystem(tower: ActiveWatchTower): THREE.Points {
    const particleCount = 100;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      // Spiral upward pattern
      const angle = (i / particleCount) * Math.PI * 4;
      const radius = (i / particleCount) * 1.5;
      const height = (i / particleCount) * 5;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = height + 1;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      // Blue-white color gradient
      colors[i * 3] = 0.3 + (i / particleCount) * 0.4;
      colors[i * 3 + 1] = 0.5 + (i / particleCount) * 0.3;
      colors[i * 3 + 2] = 1.0;

      sizes[i] = 0.1 + Math.random() * 0.1;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    return new THREE.Points(geometry, material);
  }

  public update(deltaTime: number): void {
    const towers = this.visionSystem.getWatchTowers();
    const time = performance.now() * 0.001;

    for (const tower of towers) {
      const group = this.towerMeshes.get(tower.id);
      const particles = this.particleSystems.get(tower.id);
      const light = this.glowLights.get(tower.id);

      if (!group || !particles || !light) continue;

      // Find the crystal mesh
      const crystal = group.children.find(c => c.userData.isCrystal) as THREE.Mesh;

      if (tower.isActive) {
        // Tower is activated - show effects
        particles.visible = true;

        // Animate particle rotation
        particles.rotation.y += deltaTime * 0.001;

        // Pulsing light
        const pulse = 0.5 + Math.sin(time * 3) * 0.3;
        light.intensity = 2 * pulse;

        // Glow crystal
        if (crystal && crystal.material instanceof THREE.MeshStandardMaterial) {
          crystal.material.emissiveIntensity = 0.5 + pulse * 0.5;
          crystal.material.emissive.setHex(0x4488ff);
        }

        // Float/rotate crystal
        if (crystal) {
          crystal.rotation.y = time * 2;
          crystal.position.y = 4 + Math.sin(time * 2) * 0.2;
        }
      } else {
        // Tower is inactive
        particles.visible = false;
        light.intensity = 0;

        // Dim crystal
        if (crystal && crystal.material instanceof THREE.MeshStandardMaterial) {
          crystal.material.emissiveIntensity = 0.1;
          crystal.material.emissive.setHex(0x112244);
        }

        // Reset crystal position
        if (crystal) {
          crystal.rotation.y = 0;
          crystal.position.y = 4;
        }
      }
    }
  }

  public dispose(): void {
    // Dispose tower meshes - use delayed disposal to prevent WebGPU crashes.
    // Even after scene.remove(), WebGPU may have in-flight commands using these buffers.
    for (const [, group] of this.towerMeshes) {
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          scheduleGeometryDisposal(obj.geometry, obj.material);
        }
        if (obj instanceof THREE.Points) {
          scheduleGeometryDisposal(obj.geometry, obj.material as THREE.Material);
        }
      });
    }

    this.towerMeshes.clear();
    this.particleSystems.clear();
    this.glowLights.clear();
  }
}

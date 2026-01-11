import * as THREE from 'three';
import { BiomeConfig } from './Biomes';
import { MapData } from '@/data/maps';

/**
 * Particle system for environmental effects (dust, snow, ash, etc.)
 */
export class EnvironmentParticles {
  public points: THREE.Points;
  private velocities: Float32Array;
  private particleCount: number;
  private bounds: { width: number; height: number };
  private particleType: string;

  constructor(
    mapData: MapData,
    biome: BiomeConfig
  ) {
    this.bounds = { width: mapData.width, height: mapData.height };
    this.particleType = biome.particleType;

    if (biome.particleType === 'none') {
      // Create invisible placeholder
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      const material = new THREE.PointsMaterial({ visible: false });
      this.points = new THREE.Points(geometry, material);
      this.velocities = new Float32Array(0);
      this.particleCount = 0;
      return;
    }

    this.particleCount = 1500; // 3x more particles for better atmosphere
    const positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);

    // Initialize particle positions
    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = Math.random() * mapData.width;
      positions[i * 3 + 1] = Math.random() * 30; // Height
      positions[i * 3 + 2] = Math.random() * mapData.height;

      // Initial velocities based on type
      switch (biome.particleType) {
        case 'snow':
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.5;
          this.velocities[i * 3 + 1] = -0.5 - Math.random() * 0.5;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
          break;
        case 'dust':
          this.velocities[i * 3] = (Math.random() - 0.3) * 2;
          this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
          break;
        case 'ash':
          this.velocities[i * 3] = (Math.random() - 0.5) * 1;
          this.velocities[i * 3 + 1] = 0.2 + Math.random() * 0.3;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1;
          break;
        case 'spores':
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.3;
          this.velocities[i * 3 + 1] = 0.1 + Math.random() * 0.2;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
          break;
        case 'fireflies':
          // Slow, meandering movement with random direction changes
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.4;
          this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
          // Lower initial height for fireflies (1-8 meters)
          positions[i * 3 + 1] = 1 + Math.random() * 7;
          break;
        case 'embers':
          // Rising embers with slight drift
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.8;
          this.velocities[i * 3 + 1] = 0.5 + Math.random() * 1.0; // Rising
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
          // Start lower for embers (ground level to 5m)
          positions[i * 3 + 1] = Math.random() * 5;
          break;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Particle appearance based on type
    let color: THREE.Color;
    let size: number;
    let opacity: number;

    switch (biome.particleType) {
      case 'snow':
        color = new THREE.Color(0xffffff);
        size = 0.15;
        opacity = 0.8;
        break;
      case 'dust':
        color = new THREE.Color(0xc4a060);
        size = 0.08;
        opacity = 0.4;
        break;
      case 'ash':
        color = new THREE.Color(0x404040);
        size = 0.1;
        opacity = 0.5;
        break;
      case 'spores':
        color = new THREE.Color(0x80ff80);
        size = 0.12;
        opacity = 0.6;
        break;
      case 'fireflies':
        color = new THREE.Color(0xffff40); // Warm yellow glow
        size = 0.2;
        opacity = 0.9;
        break;
      case 'embers':
        color = new THREE.Color(0xff6020); // Orange-red hot embers
        size = 0.15;
        opacity = 0.85;
        break;
      default:
        color = new THREE.Color(0xffffff);
        size = 0.1;
        opacity = 0.5;
    }

    const material = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
  }

  public update(deltaTime: number): void {
    if (this.particleCount === 0) return;

    const positions = this.points.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < this.particleCount; i++) {
      // Update position
      positions[i * 3] += this.velocities[i * 3] * deltaTime;
      positions[i * 3 + 1] += this.velocities[i * 3 + 1] * deltaTime;
      positions[i * 3 + 2] += this.velocities[i * 3 + 2] * deltaTime;

      // Wrap around bounds
      if (positions[i * 3] < 0) positions[i * 3] = this.bounds.width;
      if (positions[i * 3] > this.bounds.width) positions[i * 3] = 0;
      if (positions[i * 3 + 2] < 0) positions[i * 3 + 2] = this.bounds.height;
      if (positions[i * 3 + 2] > this.bounds.height) positions[i * 3 + 2] = 0;

      // Reset if too high or too low based on particle type
      const minHeight = 0;
      let maxHeight = 35;
      let resetHeight = 0;

      switch (this.particleType) {
        case 'snow':
          resetHeight = 35;
          break;
        case 'fireflies':
          maxHeight = 10;
          // Fireflies stay in a range, randomly pick new position if out of bounds
          if (positions[i * 3 + 1] < 1 || positions[i * 3 + 1] > maxHeight) {
            positions[i * 3 + 1] = 1 + Math.random() * 7;
            // Also randomize velocity for more organic movement
            this.velocities[i * 3] = (Math.random() - 0.5) * 0.4;
            this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
            this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
          }
          // Occasionally change direction for organic movement
          if (Math.random() < 0.01) {
            this.velocities[i * 3] += (Math.random() - 0.5) * 0.2;
            this.velocities[i * 3 + 1] += (Math.random() - 0.5) * 0.1;
            this.velocities[i * 3 + 2] += (Math.random() - 0.5) * 0.2;
          }
          continue; // Skip the generic reset below
        case 'embers':
          maxHeight = 25;
          resetHeight = 0;
          break;
        default:
          resetHeight = 0;
      }

      if (positions[i * 3 + 1] < minHeight || positions[i * 3 + 1] > maxHeight) {
        positions[i * 3 + 1] = resetHeight;
        positions[i * 3] = Math.random() * this.bounds.width;
        positions[i * 3 + 2] = Math.random() * this.bounds.height;
      }
    }

    this.points.geometry.attributes.position.needsUpdate = true;
  }

  public dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

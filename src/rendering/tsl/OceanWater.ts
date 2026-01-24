/**
 * OceanWater - Wrapper around Three.js WaterMesh for RTS games
 *
 * Uses the official Three.js WaterMesh addon (webgpu_ocean example) which provides:
 * - Real scene reflections via Reflector
 * - Proper water normal map animation
 * - Physically-based fresnel and specular
 * - Translucent, realistic water appearance
 */

import * as THREE from 'three';
import { WaterMesh } from 'three/addons/objects/WaterMesh.js';
import { MapData } from '@/data/maps';
import { BiomeConfig } from '../Biomes';

// Generate a proper water normals texture procedurally
// This mimics the waternormals.jpg from Three.js examples
function generateWaterNormals(size: number = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Normalized coordinates
      const u = x / size;
      const v = y / size;

      // Multiple octaves of waves for realistic water normal pattern
      // Using cosine waves at different frequencies
      let nx = 0;
      let nz = 0;

      // Large waves
      nx += Math.cos(u * Math.PI * 4 + v * Math.PI * 2) * 0.5;
      nz += Math.cos(v * Math.PI * 4 + u * Math.PI * 3) * 0.5;

      // Medium waves
      nx += Math.cos(u * Math.PI * 8 - v * Math.PI * 6) * 0.25;
      nz += Math.cos(v * Math.PI * 10 + u * Math.PI * 4) * 0.25;

      // Small ripples
      nx += Math.cos(u * Math.PI * 20 + v * Math.PI * 16) * 0.125;
      nz += Math.cos(v * Math.PI * 18 - u * Math.PI * 22) * 0.125;

      // Fine detail
      nx += Math.cos(u * Math.PI * 40 + v * Math.PI * 35) * 0.0625;
      nz += Math.cos(v * Math.PI * 42 - u * Math.PI * 38) * 0.0625;

      // Normalize and encode (normal map format: 0.5 = 0, 0 = -1, 1 = 1)
      const len = Math.sqrt(nx * nx + 1 + nz * nz);
      data[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);     // R = X
      data[idx + 1] = Math.floor(((1 / len) * 0.5 + 0.5) * 255);  // G = Y (up)
      data[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255); // B = Z
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return texture;
}

export interface OceanWaterConfig {
  /** Water color (default: 0x001e0f - dark teal like webgpu_ocean) */
  waterColor?: number;
  /** Sun color (default: 0xffffff) */
  sunColor?: number;
  /** Distortion scale (default: 3.7) */
  distortionScale?: number;
  /** Normal map size/scale (default: 1.0) */
  size?: number;
}

export class OceanWater {
  public mesh: WaterMesh;
  private geometry: THREE.PlaneGeometry;
  private normalMap: THREE.DataTexture;
  private sunDirection: THREE.Vector3;

  constructor(mapData: MapData, biome: BiomeConfig, config?: OceanWaterConfig) {
    // Generate water normals texture
    this.normalMap = generateWaterNormals(256);

    if (!biome.hasWater) {
      // Create minimal hidden mesh
      this.geometry = new THREE.PlaneGeometry(1, 1);
      this.sunDirection = new THREE.Vector3(0.7, 0.7, 0);
      this.mesh = new WaterMesh(this.geometry, {
        waterNormals: this.normalMap,
        sunDirection: this.sunDirection,
      });
      this.mesh.visible = false;
      return;
    }

    // Create geometry matching map size
    this.geometry = new THREE.PlaneGeometry(mapData.width, mapData.height);

    // Sun direction (matches directional light in EnvironmentManager)
    this.sunDirection = new THREE.Vector3(0.5, 0.8, 0.5).normalize();

    // Determine colors based on biome
    const isLava = biome.name === 'Volcanic';
    let waterColor = config?.waterColor ?? 0x001e0f; // Dark teal (webgpu_ocean default)
    let sunColor = config?.sunColor ?? 0xffffff;

    if (isLava) {
      waterColor = 0x1a0500; // Very dark red-brown for lava
      sunColor = 0xff6600;   // Orange sun for lava glow
    }

    // Create WaterMesh with Three.js addon
    this.mesh = new WaterMesh(this.geometry, {
      waterNormals: this.normalMap,
      sunDirection: this.sunDirection,
      sunColor: sunColor,
      waterColor: waterColor,
      distortionScale: config?.distortionScale ?? 3.7,
      size: config?.size ?? 1.0,
    });

    // Position and rotate to match terrain
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);
    this.mesh.renderOrder = 5;
  }

  /**
   * Update water animation - WaterMesh uses TSL's built-in time, no manual update needed
   * This method is kept for API compatibility but does nothing
   */
  public update(_time: number): void {
    // WaterMesh animates automatically via TSL's built-in time uniform
    // No manual update required
  }

  /**
   * Set sun direction (should match your directional light)
   */
  public setSunDirection(x: number, y: number, z: number): void {
    this.sunDirection.set(x, y, z).normalize();
  }

  /**
   * Set water color - Note: WaterMesh uniforms are set at construction time
   * This method is kept for API compatibility but requires recreating the mesh
   */
  public setWaterColor(_color: number): void {
    // WaterMesh uses TSL uniforms set at construction
    // To change color, recreate OceanWater with new config
    console.warn('OceanWater.setWaterColor: WaterMesh requires recreation to change color');
  }

  /**
   * Set distortion scale - Note: WaterMesh uniforms are set at construction time
   * This method is kept for API compatibility but requires recreating the mesh
   */
  public setDistortionScale(_scale: number): void {
    // WaterMesh uses TSL uniforms set at construction
    // To change distortion, recreate OceanWater with new config
    console.warn('OceanWater.setDistortionScale: WaterMesh requires recreation to change distortion');
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.geometry.dispose();
    this.normalMap.dispose();
    if (this.mesh.material) {
      (this.mesh.material as THREE.Material).dispose();
    }
  }
}

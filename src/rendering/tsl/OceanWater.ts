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

// Singleton texture loader and cached texture
let waterNormalsTexture: THREE.Texture | null = null;
let textureLoadPromise: Promise<THREE.Texture> | null = null;

/**
 * Load the water normals texture (same one used in Three.js webgpu_ocean example)
 */
async function loadWaterNormals(): Promise<THREE.Texture> {
  if (waterNormalsTexture) {
    return waterNormalsTexture;
  }

  if (textureLoadPromise) {
    return textureLoadPromise;
  }

  textureLoadPromise = new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/waternormals.jpg',
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        waterNormalsTexture = texture;
        resolve(texture);
      },
      undefined,
      (error) => {
        console.error('Failed to load water normals texture:', error);
        // Fall back to a simple flat normal
        const fallback = createFallbackNormalMap();
        waterNormalsTexture = fallback;
        resolve(fallback);
      }
    );
  });

  return textureLoadPromise;
}

/**
 * Get cached texture synchronously (returns fallback if not loaded yet)
 */
function getWaterNormalsSync(): THREE.Texture {
  if (waterNormalsTexture) {
    return waterNormalsTexture;
  }
  // Start loading in background
  loadWaterNormals();
  // Return fallback for now
  return createFallbackNormalMap();
}

/**
 * Create a simple fallback normal map (flat blue = pointing up)
 */
function createFallbackNormalMap(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    // Flat normal pointing up (0.5, 0.5, 1.0 in normal map space = 0, 0, 1 in world)
    data[idx] = 128;     // R = X (0)
    data[idx + 1] = 128; // G = Y (0)
    data[idx + 2] = 255; // B = Z (1 = up)
    data[idx + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
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
  private sunDirection: THREE.Vector3;

  constructor(mapData: MapData, biome: BiomeConfig, config?: OceanWaterConfig) {
    // Get water normals texture (sync - may be fallback initially)
    const waterNormals = getWaterNormalsSync();

    if (!biome.hasWater) {
      // Create minimal hidden mesh
      this.geometry = new THREE.PlaneGeometry(1, 1);
      this.sunDirection = new THREE.Vector3(0.7, 0.7, 0);
      this.mesh = new WaterMesh(this.geometry, {
        waterNormals: waterNormals,
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
      waterNormals: waterNormals,
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
    if (this.mesh.material) {
      (this.mesh.material as THREE.Material).dispose();
    }
  }
}

/**
 * Preload water normals texture - call during game initialization
 */
export async function preloadWaterNormals(): Promise<void> {
  await loadWaterNormals();
}

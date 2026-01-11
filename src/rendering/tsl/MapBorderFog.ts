/**
 * TSL Map Border Fog
 *
 * WebGPU-compatible map boundary fog effect using Three.js Shading Language.
 * Creates a premium dark, smoky fog around map edges similar to StarCraft 2.
 * Uses a single plane with shader-based distance calculation for clean edges.
 */

import * as THREE from 'three';
import {
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  smoothstep,
  clamp,
  sin,
  cos,
  positionWorld,
  max,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { MapData } from '@/data/maps';

// ============================================
// MAP BORDER FOG CLASS
// ============================================

export interface MapBorderFogConfig {
  fogColor: THREE.Color;
  borderSize: number;
  inwardEncroachment: number;
  animationSpeed: number;
}

const DEFAULT_CONFIG: MapBorderFogConfig = {
  fogColor: new THREE.Color(0x000000),
  borderSize: 100,
  inwardEncroachment: 30,
  animationSpeed: 1.0,
};

export class TSLMapBorderFog {
  public mesh: THREE.Mesh;
  private material: MeshBasicNodeMaterial;
  private uTime = uniform(0);
  private uFogColor = uniform(new THREE.Color(0x000000));
  private uMapBounds = uniform(new THREE.Vector4(0, 0, 256, 256)); // minX, minZ, maxX, maxZ
  private uFadeStart = uniform(0); // Distance from edge where fade starts (negative = inside map)
  private uFadeEnd = uniform(100); // Distance from edge where fog is fully opaque

  constructor(mapData: MapData, config: Partial<MapBorderFogConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const mapWidth = mapData.width;
    const mapHeight = mapData.height;

    // Store map bounds for shader
    this.uMapBounds.value.set(0, 0, mapWidth, mapHeight);
    this.uFadeStart.value = -cfg.inwardEncroachment; // Negative means start inside map
    this.uFadeEnd.value = cfg.borderSize;

    // Create a single large plane that covers map + border area
    const planeSize = Math.max(mapWidth, mapHeight) + cfg.borderSize * 2 + 50;
    const geometry = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);

    // Create TSL material
    this.uFogColor.value.copy(cfg.fogColor);
    this.material = this.createTSLMaterial();

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapWidth / 2, 0.15, mapHeight / 2);
    this.mesh.renderOrder = 100;
    this.mesh.frustumCulled = false; // Always render - it's the map boundary
  }

  /**
   * Creates the TSL material with premium animated volumetric fog
   */
  private createTSLMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;

    // Create the color/alpha output node
    const outputNode = Fn(() => {
      // Get world position
      const worldPos = positionWorld;
      const wx = worldPos.x;
      const wz = worldPos.z;

      // Map bounds
      const minX = this.uMapBounds.x;
      const minZ = this.uMapBounds.y;
      const maxX = this.uMapBounds.z;
      const maxZ = this.uMapBounds.w;

      // Calculate signed distance to map boundary
      // Negative = inside map, Positive = outside map
      const distToMinX = minX.sub(wx); // positive when outside left edge
      const distToMaxX = wx.sub(maxX); // positive when outside right edge
      const distToMinZ = minZ.sub(wz); // positive when outside top edge
      const distToMaxZ = wz.sub(maxZ); // positive when outside bottom edge

      // Distance to nearest edge (positive = outside, negative = inside)
      const distX = max(distToMinX, distToMaxX);
      const distZ = max(distToMinZ, distToMaxZ);

      // For corners, use the max of both axes
      // This creates a rectangular boundary that follows map edges
      const distToEdge = max(distX, distZ);

      // Fade parameters
      const fadeStart = this.uFadeStart; // negative = inside map
      const fadeEnd = this.uFadeEnd; // positive = outside map
      const fadeRange = fadeEnd.sub(fadeStart);

      // Calculate base fade (0 = fully inside/transparent, 1 = fully outside/opaque)
      const baseFade = clamp(distToEdge.sub(fadeStart).div(fadeRange), float(0.0), float(1.0));

      // ============================================
      // ANIMATED NOISE FOR ORGANIC FOG MOVEMENT
      // ============================================

      // Noise coordinates - scale position for good detail
      const noiseScale = float(0.015);
      const timeScale = float(0.3);
      const time = this.uTime.mul(timeScale);

      // Multi-octave animated noise using sin waves
      // Octave 1 - large scale swirls
      const n1x = wx.mul(noiseScale).add(time.mul(0.2));
      const n1z = wz.mul(noiseScale).sub(time.mul(0.15));
      const noise1 = sin(n1x.mul(1.7).add(cos(n1z.mul(2.3))))
        .mul(sin(n1z.mul(1.9).sub(sin(n1x.mul(1.3)))))
        .mul(0.5).add(0.5);

      // Octave 2 - medium detail
      const n2x = wx.mul(noiseScale.mul(2.5)).sub(time.mul(0.1));
      const n2z = wz.mul(noiseScale.mul(2.5)).add(time.mul(0.25));
      const noise2 = sin(n2x.mul(3.1).add(sin(n2z.mul(2.7))))
        .mul(cos(n2z.mul(2.1).add(cos(n2x.mul(3.3)))))
        .mul(0.5).add(0.5);

      // Octave 3 - fine wisps
      const n3x = wx.mul(noiseScale.mul(5.0)).add(time.mul(0.35));
      const n3z = wz.mul(noiseScale.mul(5.0)).sub(time.mul(0.2));
      const noise3 = sin(n3x.mul(5.7).sub(cos(n3z.mul(4.3))))
        .mul(sin(n3z.mul(6.1).add(sin(n3x.mul(5.9)))))
        .mul(0.5).add(0.5);

      // Combine noise octaves with decreasing weights
      const combinedNoise = noise1.mul(0.5).add(noise2.mul(0.3)).add(noise3.mul(0.2));

      // Create wispy tendrils effect
      const wisps = smoothstep(float(0.3), float(0.7), combinedNoise);

      // ============================================
      // APPLY NOISE TO FADE FOR ORGANIC EDGE
      // ============================================

      // Modulate fade with noise for organic boundary
      const noiseInfluence = float(0.15); // How much noise affects the edge
      const noisyFade = clamp(
        baseFade.add(combinedNoise.sub(0.5).mul(noiseInfluence).mul(baseFade)),
        float(0.0),
        float(1.0)
      );

      // ============================================
      // PREMIUM FADE CURVE
      // ============================================

      // Use a steep S-curve for quick fog rise at edge
      // First apply smoothstep for initial transition
      let alpha = smoothstep(float(0.0), float(0.25), noisyFade);

      // Apply power curve for steeper rise
      alpha = alpha.mul(alpha).mul(float(3.0).sub(alpha.mul(2.0))); // Hermite interpolation

      // Add wispy variation to the fog density
      const wispStrength = float(0.12);
      alpha = alpha.mul(float(1.0).sub(wispStrength).add(wisps.mul(wispStrength)));

      // Clamp and apply final opacity
      alpha = clamp(alpha, float(0.0), float(0.98));

      // ============================================
      // FOG COLOR WITH SUBTLE VARIATION
      // ============================================

      // Add very subtle color variation based on noise
      const colorVariation = float(0.08);
      const fogR = this.uFogColor.x.add(combinedNoise.mul(colorVariation).sub(colorVariation.mul(0.5)));
      const fogG = this.uFogColor.y.add(noise2.mul(colorVariation.mul(0.5)).sub(colorVariation.mul(0.25)));
      const fogB = this.uFogColor.z.add(noise1.mul(colorVariation).sub(colorVariation.mul(0.5)));

      const finalColor = vec3(
        clamp(fogR, float(0.0), float(0.15)),
        clamp(fogG, float(0.0), float(0.12)),
        clamp(fogB, float(0.0), float(0.18))
      );

      return vec4(finalColor, alpha);
    })();

    material.colorNode = outputNode;

    return material;
  }

  /**
   * Update animation
   */
  public update(time: number): void {
    this.uTime.value = time;
  }

  /**
   * Set fog color
   */
  public setColor(color: THREE.Color): void {
    this.uFogColor.value.copy(color);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.material as THREE.Material).dispose();
  }
}

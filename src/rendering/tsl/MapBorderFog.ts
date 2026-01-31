/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
/**
 * TSL Map Border Fog
 *
 * WebGPU-compatible map boundary fog effect using Three.js Shading Language.
 * Creates dark, smoky fog around map edges.
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
  uv,
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
  inwardEncroachment: 25,
  animationSpeed: 1.0,
};

export class TSLMapBorderFog {
  public mesh: THREE.Mesh;
  private material: MeshBasicNodeMaterial;
  private uTime = uniform(0);
  private uFogColor = uniform(new THREE.Color(0x000000));
  // Plane dimensions for UV to world conversion
  private uPlaneSize = uniform(new THREE.Vector2(256, 256));
  private uPlaneCenter = uniform(new THREE.Vector2(128, 128));
  // Map bounds relative to plane center
  private uMapMin = uniform(new THREE.Vector2(0, 0));
  private uMapMax = uniform(new THREE.Vector2(256, 256));
  // Fade distances
  private uFadeStart = uniform(-25); // negative = start inside map
  private uFadeEnd = uniform(80); // distance to full opacity

  constructor(mapData: MapData, config: Partial<MapBorderFogConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const mapWidth = mapData.width;
    const mapHeight = mapData.height;

    // Plane extends beyond map in all directions
    const borderExtent = cfg.borderSize + 20;
    const planeWidth = mapWidth + borderExtent * 2;
    const planeHeight = mapHeight + borderExtent * 2;
    const planeCenterX = mapWidth / 2;
    const planeCenterZ = mapHeight / 2;

    // Set uniforms
    this.uPlaneSize.value.set(planeWidth, planeHeight);
    this.uPlaneCenter.value.set(planeCenterX, planeCenterZ);
    this.uMapMin.value.set(0, 0);
    this.uMapMax.value.set(mapWidth, mapHeight);
    this.uFadeStart.value = -cfg.inwardEncroachment;
    this.uFadeEnd.value = cfg.borderSize;
    this.uFogColor.value.copy(cfg.fogColor);

    // Create plane geometry (simple quad is fine - shader does the work)
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 1, 1);

    // Create TSL material
    this.material = this.createTSLMaterial();

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(planeCenterX, 0.2, planeCenterZ);
    this.mesh.renderOrder = 999; // Render on top
    this.mesh.frustumCulled = false;
  }

  /**
   * Creates the TSL material with animated volumetric fog.
   */
  private createTSLMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;

    // Create the color/alpha output node
    const outputNode = Fn(() => {
      // Get UV coordinates (0-1 range, correctly interpolated per fragment)
      const uvCoord = uv();

      // Convert UV to world XZ position
      // UV (0,0) is bottom-left of plane, (1,1) is top-right
      // After -90 degree X rotation: UV.x -> world X, UV.y -> world Z
      const planeW = this.uPlaneSize.x;
      const planeH = this.uPlaneSize.y;
      const centerX = this.uPlaneCenter.x;
      const centerZ = this.uPlaneCenter.y;

      // World position from UV
      const wx = uvCoord.x.sub(0.5).mul(planeW).add(centerX);
      const wz = uvCoord.y.sub(0.5).mul(planeH).add(centerZ);

      // Map bounds
      const minX = this.uMapMin.x;
      const minZ = this.uMapMin.y;
      const maxX = this.uMapMax.x;
      const maxZ = this.uMapMax.y;

      // Calculate signed distance to map boundary
      // Negative = inside map, Positive = outside map
      const distToMinX = minX.sub(wx); // positive when outside left edge
      const distToMaxX = wx.sub(maxX); // positive when outside right edge
      const distToMinZ = minZ.sub(wz); // positive when outside top edge
      const distToMaxZ = wz.sub(maxZ); // positive when outside bottom edge

      // Distance to nearest edge (positive = outside, negative = inside)
      const distX = max(distToMinX, distToMaxX);
      const distZ = max(distToMinZ, distToMaxZ);

      // For rectangular boundary, use max of both axes
      const distToEdge = max(distX, distZ);

      // Fade parameters
      const fadeStart = this.uFadeStart;
      const fadeEnd = this.uFadeEnd;
      const fadeRange = fadeEnd.sub(fadeStart);

      // Calculate base fade (0 = inside map/transparent, 1 = outside/opaque)
      const baseFade = clamp(distToEdge.sub(fadeStart).div(fadeRange), float(0.0), float(1.0));

      // ============================================
      // ANIMATED NOISE FOR ORGANIC FOG MOVEMENT
      // ============================================

      const noiseScale = float(0.02);
      const timeScale = float(0.25);
      const time = this.uTime.mul(timeScale);

      // Multi-octave animated noise
      // Octave 1 - large scale swirls
      const n1x = wx.mul(noiseScale).add(time.mul(0.15));
      const n1z = wz.mul(noiseScale).sub(time.mul(0.1));
      const noise1 = sin(n1x.mul(1.7).add(cos(n1z.mul(2.3))))
        .mul(sin(n1z.mul(1.9).sub(sin(n1x.mul(1.3)))))
        .mul(0.5).add(0.5);

      // Octave 2 - medium detail
      const n2x = wx.mul(noiseScale.mul(2.0)).sub(time.mul(0.08));
      const n2z = wz.mul(noiseScale.mul(2.0)).add(time.mul(0.12));
      const noise2 = sin(n2x.mul(3.1).add(sin(n2z.mul(2.7))))
        .mul(cos(n2z.mul(2.1).add(cos(n2x.mul(3.3)))))
        .mul(0.5).add(0.5);

      // Octave 3 - fine wisps
      const n3x = wx.mul(noiseScale.mul(4.0)).add(time.mul(0.2));
      const n3z = wz.mul(noiseScale.mul(4.0)).sub(time.mul(0.15));
      const noise3 = sin(n3x.mul(5.7).sub(cos(n3z.mul(4.3))))
        .mul(sin(n3z.mul(6.1).add(sin(n3x.mul(5.9)))))
        .mul(0.5).add(0.5);

      // Combine octaves
      const combinedNoise = noise1.mul(0.5).add(noise2.mul(0.3)).add(noise3.mul(0.2));

      // Wispy tendrils
      const wisps = smoothstep(float(0.35), float(0.65), combinedNoise);

      // ============================================
      // APPLY NOISE TO EDGE FOR ORGANIC BOUNDARY
      // ============================================

      const noiseInfluence = float(0.12);
      const noisyFade = clamp(
        baseFade.add(combinedNoise.sub(0.5).mul(noiseInfluence).mul(baseFade.mul(2.0).add(0.5))),
        float(0.0),
        float(1.0)
      );

      // Fade curve: steep S-curve for quick fog rise at edge
      let alpha = smoothstep(float(0.0), float(0.35), noisyFade);

      // Additional shaping
      alpha = alpha.mul(alpha).mul(float(3.0).sub(alpha.mul(2.0)));

      // Add wispy variation
      const wispStrength = float(0.1);
      alpha = alpha.mul(float(1.0).sub(wispStrength).add(wisps.mul(wispStrength)));

      // Final clamp
      alpha = clamp(alpha, float(0.0), float(0.95));

      // ============================================
      // FOG COLOR
      // ============================================

      // Subtle color variation
      const colorVar = float(0.05);
      const fogR = this.uFogColor.x.add(combinedNoise.mul(colorVar).sub(colorVar.mul(0.5)));
      const fogG = this.uFogColor.y.add(noise2.mul(colorVar.mul(0.5)));
      const fogB = this.uFogColor.z.add(noise1.mul(colorVar));

      const finalColor = vec3(
        clamp(fogR, float(0.0), float(0.1)),
        clamp(fogG, float(0.0), float(0.08)),
        clamp(fogB, float(0.0), float(0.12))
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

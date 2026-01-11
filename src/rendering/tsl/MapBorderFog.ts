/**
 * TSL Map Border Fog
 *
 * WebGPU-compatible map boundary fog effect using Three.js Shading Language.
 * Creates a dark, smoky fog around map edges similar to StarCraft 2.
 * Works with both WebGPU and WebGL renderers.
 */

import * as THREE from 'three';
import {
  attribute,
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
  floor,
  fract,
  dot,
  mix,
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
  borderSize: 80,
  inwardEncroachment: 25,
  animationSpeed: 1.0,
};

export class TSLMapBorderFog {
  public mesh: THREE.Mesh;
  private material: MeshBasicNodeMaterial;
  private uTime = uniform(0);
  private uFogColor = uniform(new THREE.Color(0x000000));

  constructor(mapData: MapData, config: Partial<MapBorderFogConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const mapWidth = mapData.width;
    const mapHeight = mapData.height;

    // Calculate dimensions
    const fadeDistance = cfg.borderSize + cfg.inwardEncroachment;
    const innerWidth = mapWidth - cfg.inwardEncroachment * 2;
    const innerHeight = mapHeight - cfg.inwardEncroachment * 2;
    const outerWidth = mapWidth + cfg.borderSize * 2;
    const outerHeight = mapHeight + cfg.borderSize * 2;

    // Create ring geometry
    const geometry = this.createBorderGeometry(
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      fadeDistance
    );

    // Create TSL material
    this.uFogColor.value.copy(cfg.fogColor);
    this.material = this.createTSLMaterial();

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapWidth / 2, 0.1, mapHeight / 2);
    this.mesh.renderOrder = 100;
  }

  /**
   * Creates the TSL material with animated noise
   */
  private createTSLMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;

    // Get the fade attribute from geometry
    const fadeAttr = attribute('fade', 'float');

    // Simple hash-based noise function in TSL
    const hash = Fn(([p]: [any]) => {
      const px = p.x;
      const py = p.y;
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
    });

    // Create the color/alpha output node
    const outputNode = Fn(() => {
      // Get world position for noise sampling
      const worldPos = positionWorld;
      const noiseCoord = vec3(worldPos.x.mul(0.02), worldPos.z.mul(0.02), this.uTime.mul(0.005));

      // Simple layered noise using sin waves (fast and compatible)
      const n1 = sin(noiseCoord.x.mul(3.0).add(this.uTime.mul(0.1)))
        .mul(sin(noiseCoord.y.mul(2.7).sub(this.uTime.mul(0.08))))
        .mul(0.5).add(0.5);

      const n2 = sin(noiseCoord.x.mul(7.0).sub(this.uTime.mul(0.05)))
        .mul(sin(noiseCoord.y.mul(5.3).add(this.uTime.mul(0.12))))
        .mul(0.25).add(0.25);

      const n3 = sin(noiseCoord.x.mul(13.0).add(this.uTime.mul(0.15)))
        .mul(sin(noiseCoord.y.mul(11.7).sub(this.uTime.mul(0.07))))
        .mul(0.125).add(0.125);

      // Combined noise
      const noise = n1.add(n2).add(n3).div(1.5);

      // Wispy smoke effect
      const wisps = smoothstep(float(0.35), float(0.65), noise);

      // Apply noise to fade edge for organic boundary
      const noisyFade = clamp(fadeAttr.add(noise.sub(0.5).mul(0.12)), float(0.0), float(1.0));

      // Steep fade curve for quick opacity rise
      let alpha = smoothstep(float(0.0), float(0.3), noisyFade);
      alpha = alpha.mul(alpha); // Quadratic
      alpha = clamp(alpha.mul(1.3), float(0.0), float(1.0));
      alpha = alpha.mul(float(0.92).add(wisps.mul(0.08)));

      // Color with subtle variation
      const color = mix(this.uFogColor, vec3(0.02, 0.015, 0.025), noise.mul(0.15));

      return vec4(color, alpha);
    })();

    material.colorNode = outputNode;

    return material;
  }

  /**
   * Creates a ring/frame geometry surrounding the map
   */
  private createBorderGeometry(
    mapWidth: number,
    mapHeight: number,
    outerWidth: number,
    outerHeight: number,
    _fadeDistance: number
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const fades: number[] = [];
    const indices: number[] = [];

    const halfMapW = mapWidth / 2;
    const halfMapH = mapHeight / 2;
    const halfOuterW = outerWidth / 2;
    const halfOuterH = outerHeight / 2;

    let vertexIndex = 0;

    const addSection = (
      innerX1: number, innerZ1: number,
      innerX2: number, innerZ2: number,
      outerX1: number, outerZ1: number,
      outerX2: number, outerZ2: number,
      segsX: number, segsZ: number
    ) => {
      for (let iz = 0; iz <= segsZ; iz++) {
        const tz = iz / segsZ;
        const fade = tz;

        for (let ix = 0; ix <= segsX; ix++) {
          const tx = ix / segsX;

          const x = innerX1 + (innerX2 - innerX1) * tx +
                    (outerX1 + (outerX2 - outerX1) * tx - (innerX1 + (innerX2 - innerX1) * tx)) * tz;
          const z = innerZ1 + (innerZ2 - innerZ1) * tx +
                    (outerZ1 + (outerZ2 - outerZ1) * tx - (innerZ1 + (innerZ2 - innerZ1) * tx)) * tz;

          positions.push(x, 0, z);
          uvs.push(tx, tz);
          fades.push(fade);
        }
      }

      for (let iz = 0; iz < segsZ; iz++) {
        for (let ix = 0; ix < segsX; ix++) {
          const base = vertexIndex + iz * (segsX + 1) + ix;
          const nextRow = base + segsX + 1;

          indices.push(base, nextRow, base + 1);
          indices.push(base + 1, nextRow, nextRow + 1);
        }
      }

      vertexIndex += (segsX + 1) * (segsZ + 1);
    };

    const segs = 16;
    const segsSide = 32;

    // Top border (north)
    addSection(
      -halfMapW, -halfMapH,
      halfMapW, -halfMapH,
      -halfOuterW, -halfOuterH,
      halfOuterW, -halfOuterH,
      segsSide, segs
    );

    // Bottom border (south)
    addSection(
      -halfMapW, halfMapH,
      halfMapW, halfMapH,
      -halfOuterW, halfOuterH,
      halfOuterW, halfOuterH,
      segsSide, segs
    );

    // Left border (west)
    addSection(
      -halfMapW, -halfMapH,
      -halfMapW, halfMapH,
      -halfOuterW, -halfOuterH,
      -halfOuterW, halfOuterH,
      segs, segsSide
    );

    // Right border (east)
    addSection(
      halfMapW, -halfMapH,
      halfMapW, halfMapH,
      halfOuterW, -halfOuterH,
      halfOuterW, halfOuterH,
      segs, segsSide
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('fade', new THREE.Float32BufferAttribute(fades, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
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
    this.material.dispose();
  }
}

/**
 * TSL Water/Lava Plane
 *
 * WebGPU-compatible animated water/lava effect using Three.js Shading Language.
 * Works with both WebGPU and WebGL renderers.
 */

import * as THREE from 'three';
import {
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  uv,
  sin,
  mix,
  positionLocal,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { MapData } from '@/data/maps';
import { BiomeConfig } from '../Biomes';

export class TSLWaterPlane {
  public mesh: THREE.Mesh;
  private material: MeshBasicNodeMaterial;

  // Uniforms
  private uTime = uniform(0);
  private uColor1 = uniform(new THREE.Color(0x206090));
  private uColor2 = uniform(new THREE.Color(0x206090));
  private uIsLava = uniform(0);

  constructor(mapData: MapData, biome: BiomeConfig) {
    if (!biome.hasWater) {
      // Create invisible placeholder
      const geometry = new THREE.PlaneGeometry(1, 1);
      this.material = new MeshBasicNodeMaterial();
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.visible = false;
      return;
    }

    const geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, 32, 32);

    // Determine if this is lava or water
    const isLava = biome.name === 'Volcanic';

    // Set uniforms
    this.uColor1.value.copy(biome.colors.water);
    this.uColor2.value.copy(isLava ? new THREE.Color(0xff8040) : new THREE.Color(0x206090));
    this.uIsLava.value = isLava ? 1.0 : 0.0;

    // Create TSL material
    this.material = this.createTSLMaterial();

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);
  }

  private createTSLMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;

    // Create animated water/lava effect
    const outputNode = Fn(() => {
      const uvCoord = uv();
      const pos = positionLocal;

      // Calculate wave height for vertex displacement effect simulation
      const wave1 = sin(pos.x.mul(0.5).add(this.uTime)).mul(0.1);
      const wave2 = sin(pos.y.mul(0.3).add(this.uTime.mul(0.7))).mul(0.08);
      const waveHeight = wave1.add(wave2);

      // Animated color blend
      const blend1 = sin(uvCoord.x.mul(10.0).add(this.uTime)).mul(0.5).add(0.5);
      const blend2 = sin(uvCoord.y.mul(8.0).add(this.uTime.mul(0.8))).mul(0.5).add(0.5);
      const blend = blend1.mul(blend2);

      // Mix colors
      let color = mix(this.uColor1, this.uColor2, blend.mul(0.3));

      // Height-based brightness
      color = color.add(waveHeight.mul(0.5));

      // Lava glow effect
      const lavaGlow = sin(this.uTime.mul(2.0)).mul(0.3).add(0.7);
      const lavaColor = vec3(0.3, 0.1, 0.0).mul(lavaGlow);
      color = mix(color, color.add(lavaColor), this.uIsLava);

      // Transparency - lava is more opaque
      const waterAlpha = float(0.7).add(waveHeight.mul(0.2));
      const lavaAlpha = float(0.95);
      const alpha = mix(waterAlpha, lavaAlpha, this.uIsLava);

      return vec4(color, alpha);
    })();

    material.colorNode = outputNode;

    return material;
  }

  public update(time: number): void {
    if (this.mesh.visible) {
      this.uTime.value = time;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

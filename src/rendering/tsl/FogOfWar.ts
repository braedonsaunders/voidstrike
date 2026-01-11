/**
 * TSL Fog of War
 *
 * WebGPU-compatible fog of war implementation using Three.js Shading Language.
 * Works with both WebGPU and WebGL renderers.
 */

import * as THREE from 'three';
import {
  Fn,
  vec4,
  float,
  uniform,
  texture,
  uv,
  mix,
  step,
  smoothstep,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { isSpectatorMode } from '@/store/gameSetupStore';

export interface TSLFogOfWarConfig {
  mapWidth: number;
  mapHeight: number;
  cellSize?: number;
  unexploredColor?: THREE.Color;
  exploredColor?: THREE.Color;
}

export class TSLFogOfWar {
  public mesh: THREE.Mesh;

  private mapWidth: number;
  private mapHeight: number;
  private cellSize: number;
  private gridWidth: number;
  private gridHeight: number;

  private geometry: THREE.PlaneGeometry;
  private material: MeshBasicNodeMaterial;
  private fogTexture: THREE.DataTexture;
  private textureData: Uint8Array;

  private visionSystem: VisionSystem | null = null;
  private playerId: string | null = null;

  // Uniforms for TSL
  private uUnexploredColor = uniform(new THREE.Color(0x2a3a4a));
  private uExploredColor = uniform(new THREE.Color(0x1a2a3a));

  // PERFORMANCE: Throttle updates
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100; // Only update every 100ms

  constructor(config: TSLFogOfWarConfig) {
    this.mapWidth = config.mapWidth;
    this.mapHeight = config.mapHeight;
    this.cellSize = config.cellSize ?? 2;
    this.gridWidth = Math.ceil(this.mapWidth / this.cellSize);
    this.gridHeight = Math.ceil(this.mapHeight / this.cellSize);

    // Create texture data (RGBA, one byte per channel)
    this.textureData = new Uint8Array(this.gridWidth * this.gridHeight * 4);
    // Initialize all to unexplored (black, full opacity)
    for (let i = 0; i < this.gridWidth * this.gridHeight; i++) {
      this.textureData[i * 4 + 0] = 0; // R
      this.textureData[i * 4 + 1] = 0; // G
      this.textureData[i * 4 + 2] = 0; // B
      this.textureData[i * 4 + 3] = 255; // A (full opacity = unexplored)
    }

    // Create texture
    this.fogTexture = new THREE.DataTexture(
      this.textureData,
      this.gridWidth,
      this.gridHeight,
      THREE.RGBAFormat
    );
    this.fogTexture.needsUpdate = true;
    this.fogTexture.minFilter = THREE.LinearFilter;
    this.fogTexture.magFilter = THREE.LinearFilter;

    // Set custom colors if provided
    if (config.unexploredColor) {
      this.uUnexploredColor.value.copy(config.unexploredColor);
    }
    if (config.exploredColor) {
      this.uExploredColor.value.copy(config.exploredColor);
    }

    // Create TSL material
    this.material = this.createTSLMaterial();

    // Create geometry - plane covering the entire map
    this.geometry = new THREE.PlaneGeometry(this.mapWidth, this.mapHeight);

    // Create mesh
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(this.mapWidth / 2, 0.5, this.mapHeight / 2);
    this.mesh.renderOrder = 100; // Render after terrain
  }

  private createTSLMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    // Create the fog shader using TSL
    const outputNode = Fn(() => {
      // Sample fog texture
      const fogData = texture(this.fogTexture, uv());
      // visibility: 0 = unexplored (alpha=255), 0.5 = explored (alpha=128), 1 = visible (alpha=0)
      const visibility = float(1.0).sub(fogData.a);

      // Use step/smoothstep for GPU-friendly branching
      // Unexplored: visibility < 0.01
      // Explored: 0.01 <= visibility < 0.75
      // Visible: visibility >= 0.75

      // Step functions to determine state
      const notUnexplored = step(float(0.01), visibility); // 1 if explored or visible
      const isVisible = step(float(0.75), visibility); // 1 if visible

      // Alpha values: unexplored=0.7, explored=0.35, visible=0
      const unexploredAlpha = float(0.7);
      const exploredAlpha = float(0.35);
      const visibleAlpha = float(0.0);

      // Mix alpha based on state
      // Start with unexplored, mix to explored if notUnexplored, mix to visible if isVisible
      const alpha = mix(
        mix(unexploredAlpha, exploredAlpha, notUnexplored),
        visibleAlpha,
        isVisible
      );

      // Mix colors based on state
      const color = mix(this.uUnexploredColor, this.uExploredColor, notUnexplored);

      return vec4(color, alpha);
    })();

    material.colorNode = outputNode;

    return material;
  }

  public setVisionSystem(visionSystem: VisionSystem): void {
    this.visionSystem = visionSystem;
  }

  public setPlayerId(playerId: string | null): void {
    this.playerId = playerId;
  }

  public update(): void {
    if (!this.visionSystem) return;

    // In spectator mode, hide the fog mesh entirely (see everything)
    if (isSpectatorMode() || !this.playerId) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // PERFORMANCE: Throttle updates
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    const visionGrid = this.visionSystem.getVisionGridForPlayer(this.playerId);
    if (!visionGrid) return;

    // Update texture data based on vision
    // Note: Flip Y when writing to texture because after plane rotation (-PI/2 around X),
    // texture V=0 corresponds to high world Z, but visionGrid[0] is low world Z
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const textureY = this.gridHeight - 1 - y;
        const i = textureY * this.gridWidth + x;
        const state = visionGrid[y]?.[x] ?? 'unexplored';

        // Alpha determines fog level: 255 = full fog, 0 = no fog
        let alpha: number;
        switch (state) {
          case 'visible':
            alpha = 0; // No fog
            break;
          case 'explored':
            alpha = 128; // Partial fog
            break;
          case 'unexplored':
          default:
            alpha = 255; // Full fog
            break;
        }

        this.textureData[i * 4 + 3] = alpha;
      }
    }

    this.fogTexture.needsUpdate = true;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.fogTexture.dispose();
  }
}

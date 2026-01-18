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
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { VisionCompute } from '@/rendering/compute/VisionCompute';
import { isSpectatorMode } from '@/store/gameSetupStore';
import { debugShaders } from '@/utils/debugLogger';

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
  private playerIndex: number = 0; // Numeric index for GPU vision

  // GPU Vision Compute (optional, for high-performance mode)
  private gpuVisionCompute: VisionCompute | null = null;
  private useGPUVision: boolean = false;
  private lastGPUVisionVersion: number = -1;

  // Uniforms for TSL
  private uUnexploredColor = uniform(new THREE.Color(0x2a3a4a));
  private uExploredColor = uniform(new THREE.Color(0x1a2a3a));

  // PERFORMANCE: Throttle updates
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100; // Only update every 100ms (CPU path)
  private gpuUpdateInterval: number = 16; // GPU path can update more frequently

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
    // Position fog above all terrain (terrain heights range from 0 to ~10 units based on elevation)
    this.mesh.position.set(this.mapWidth / 2, 12, this.mapHeight / 2);
    this.mesh.renderOrder = 100; // Render after terrain
  }

  private createTSLMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    // Use outputNode to control both color and alpha in one vec4
    const outputNode = Fn(() => {
      // Sample fog texture
      const fogData = texture(this.fogTexture, uv());
      // visibility: 0 = unexplored (alpha=255), 0.5 = explored (alpha=128), 1 = visible (alpha=0)
      const visibility = float(1.0).sub(fogData.a);

      // Step functions to determine state
      const notUnexplored = step(float(0.01), visibility); // 1 if explored or visible
      const isVisible = step(float(0.75), visibility); // 1 if visible

      // Alpha values: unexplored=0.7, explored=0.35, visible=0
      const unexploredAlpha = float(0.7);
      const exploredAlpha = float(0.35);
      const visibleAlpha = float(0.0);

      // Mix alpha based on state
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

    // Check if GPU vision is available
    const gpuCompute = visionSystem.getGPUVisionCompute();
    if (gpuCompute && gpuCompute.isAvailable()) {
      this.gpuVisionCompute = gpuCompute;
      this.useGPUVision = true;
      debugShaders.log('[FogOfWar] Using GPU vision compute');
    }
  }

  public setPlayerId(playerId: string | null): void {
    this.playerId = playerId;
    // Update player index for GPU vision
    if (playerId && this.visionSystem) {
      // Get the player index from vision system
      // The index is determined by registration order
      const knownPlayers = Array.from((this.visionSystem as any).knownPlayers || []);
      this.playerIndex = knownPlayers.indexOf(playerId);
      if (this.playerIndex === -1) this.playerIndex = 0;
    }
  }

  /**
   * Enable GPU vision mode (called when GPU compute is available)
   */
  public setGPUVisionCompute(gpuCompute: VisionCompute | null): void {
    this.gpuVisionCompute = gpuCompute;
    this.useGPUVision = gpuCompute !== null && gpuCompute.isAvailable();
  }

  public update(): void {
    if (!this.visionSystem) return;

    // In spectator mode, hide the fog mesh entirely (see everything)
    if (isSpectatorMode() || !this.playerId) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Use GPU vision path if available
    if (this.useGPUVision && this.gpuVisionCompute) {
      this.updateFromGPUVision();
      return;
    }

    // CPU/Worker path with throttling
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

  /**
   * Update fog texture from GPU vision compute
   * GPU path can update more frequently since computation is fast
   */
  private updateFromGPUVision(): void {
    if (!this.gpuVisionCompute || !this.playerId) return;

    // Check if vision has changed
    const currentVersion = this.gpuVisionCompute.getVisionVersion();
    if (currentVersion === this.lastGPUVisionVersion) {
      return; // No change, skip update
    }
    this.lastGPUVisionVersion = currentVersion;

    // Throttle even GPU path to avoid excessive texture uploads
    const now = performance.now();
    if (now - this.lastUpdateTime < this.gpuUpdateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    // Get GPU vision texture and copy to our fog texture
    const gpuTex = this.gpuVisionCompute.getVisionTexture(this.playerIndex);
    if (!gpuTex) return;

    const gpuData = gpuTex.image.data as Uint8Array;

    // Copy GPU vision data to fog texture with Y flip
    // GPU texture format: RGBA where R=explored, G=visible
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const textureY = this.gridHeight - 1 - y;
        const fogIdx = textureY * this.gridWidth + x;
        const gpuIdx = (y * this.gridWidth + x) * 4;

        const explored = gpuData[gpuIdx + 0];
        const visible = gpuData[gpuIdx + 1];

        // Alpha determines fog level: 255 = full fog, 0 = no fog
        let alpha: number;
        if (visible > 0) {
          alpha = 0; // Visible - no fog
        } else if (explored > 0) {
          alpha = 128; // Explored - partial fog
        } else {
          alpha = 255; // Unexplored - full fog
        }

        this.textureData[fogIdx * 4 + 3] = alpha;
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

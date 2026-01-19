/**
 * TSL Fog of War
 *
 * WebGPU-compatible fog of war implementation using Three.js Shading Language.
 *
 * GPU-Only Path (Option A):
 * - VisionCompute writes vision data to a StorageTexture via compute shader
 * - FogOfWar shader samples the StorageTexture directly - no CPU readback
 * - Eliminates the CPU→GPU texture upload bottleneck entirely
 *
 * Fallback CPU Path:
 * - Uses DataTexture for vision data
 * - VisionSystem updates texture via worker thread
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

  // CPU fallback: DataTexture for vision data
  private cpuFogTexture: THREE.DataTexture;
  private cpuTextureData: Uint8Array;

  // GPU path: StorageTexture reference from VisionCompute
  private gpuStorageTexture: THREE.Texture | null = null;

  private visionSystem: VisionSystem | null = null;
  private playerId: string | null = null;
  private playerIndex: number = 0;

  // GPU Vision Compute reference
  private gpuVisionCompute: VisionCompute | null = null;
  private useGPUVision: boolean = false;

  // Uniforms for TSL
  private uUnexploredColor = uniform(new THREE.Color(0x2a3a4a));
  private uExploredColor = uniform(new THREE.Color(0x1a2a3a));
  private uUseGPUTexture = uniform(0); // 0 = CPU, 1 = GPU

  // Throttle CPU updates
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100; // ms

  constructor(config: TSLFogOfWarConfig) {
    this.mapWidth = config.mapWidth;
    this.mapHeight = config.mapHeight;
    this.cellSize = config.cellSize ?? 2;
    this.gridWidth = Math.ceil(this.mapWidth / this.cellSize);
    this.gridHeight = Math.ceil(this.mapHeight / this.cellSize);

    // Create CPU fallback texture
    this.cpuTextureData = new Uint8Array(this.gridWidth * this.gridHeight * 4);
    for (let i = 0; i < this.gridWidth * this.gridHeight; i++) {
      this.cpuTextureData[i * 4 + 0] = 0;   // R
      this.cpuTextureData[i * 4 + 1] = 0;   // G
      this.cpuTextureData[i * 4 + 2] = 0;   // B
      this.cpuTextureData[i * 4 + 3] = 255; // A (full opacity = unexplored)
    }

    this.cpuFogTexture = new THREE.DataTexture(
      this.cpuTextureData,
      this.gridWidth,
      this.gridHeight,
      THREE.RGBAFormat
    );
    this.cpuFogTexture.needsUpdate = true;
    this.cpuFogTexture.minFilter = THREE.LinearFilter;
    this.cpuFogTexture.magFilter = THREE.LinearFilter;

    // Set custom colors if provided
    if (config.unexploredColor) {
      this.uUnexploredColor.value.copy(config.unexploredColor);
    }
    if (config.exploredColor) {
      this.uExploredColor.value.copy(config.exploredColor);
    }

    // Create TSL material (initially using CPU texture)
    this.material = this.createTSLMaterial();

    // Create geometry - plane covering the map
    this.geometry = new THREE.PlaneGeometry(this.mapWidth, this.mapHeight);

    // Create mesh
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(this.mapWidth / 2, 12, this.mapHeight / 2);
    this.mesh.renderOrder = 100;
  }

  /**
   * Create TSL material that can sample either CPU DataTexture or GPU StorageTexture
   *
   * The shader branches based on uUseGPUTexture uniform:
   * - CPU path: samples cpuFogTexture (DataTexture with alpha encoding)
   * - GPU path: samples gpuStorageTexture (RGBA where R=explored, G=visible)
   */
  private createTSLMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const cpuTex = this.cpuFogTexture;
    const unexploredColor = this.uUnexploredColor;
    const exploredColor = this.uExploredColor;

    // CPU-only path - StorageTexture sampling not working in TSL fragment shaders
    // See: https://discourse.threejs.org/t/cannot-use-textureload-in-fn-to-read-from-storagetexture-instance/81240
    const outputNode = Fn(() => {
      // Sample CPU texture (alpha encoding)
      const cpuData = texture(cpuTex, uv());

      // CPU path: visibility encoded in alpha
      // alpha=255 → unexplored, alpha=128 → explored, alpha=0 → visible
      const visibility = float(1.0).sub(cpuData.a);

      // Step functions to determine state
      const notUnexplored = step(float(0.01), visibility);
      const isVisible = step(float(0.75), visibility);

      // Alpha: unexplored=0.7, explored=0.35, visible=0
      const alpha = mix(
        mix(float(0.7), float(0.35), notUnexplored),
        float(0.0),
        isVisible
      );

      // Color: unexplored vs explored
      const color = mix(unexploredColor, exploredColor, notUnexplored);

      return vec4(color, alpha);
    })();

    material.colorNode = outputNode;

    return material;
  }

  /**
   * Rebuild material with GPU texture bound
   * Called when GPU vision becomes available
   *
   * NOTE: StorageTexture sampling in fragment shaders has issues in TSL.
   * For now, we keep using the CPU path until this is resolved.
   * See: https://discourse.threejs.org/t/cannot-use-textureload-in-fn-to-read-from-storagetexture-instance/81240
   */
  private rebuildMaterialWithGPUTexture(): void {
    // DISABLED: StorageTexture sampling not working in TSL fragment shaders
    // Keep using CPU fallback path until a proper solution is found
    debugShaders.warn('[FogOfWar] GPU StorageTexture sampling disabled - using CPU fallback');
    return;

    if (!this.gpuStorageTexture) return;

    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const gpuTex = this.gpuStorageTexture;
    const unexploredColor = this.uUnexploredColor;
    const exploredColor = this.uExploredColor;

    // GPU-only shader path - no branching, direct StorageTexture sampling
    const outputNode = Fn(() => {
      // Sample GPU StorageTexture directly
      // Format: RGBA where R=explored (0-1), G=visible (0-1)
      const visionData = texture(gpuTex, uv());
      const explored = visionData.r;
      const visible = visionData.g;

      // Convert to visibility: visible > explored > unexplored
      // visible: visibility = 1.0
      // explored: visibility = 0.5
      // unexplored: visibility = 0.0
      const visibility = mix(
        mix(float(0), float(0.5), step(float(0.5), explored)),
        float(1.0),
        step(float(0.5), visible)
      );

      const notUnexplored = step(float(0.01), visibility);
      const isVisible = step(float(0.75), visibility);

      // Alpha: unexplored=0.7, explored=0.35, visible=0
      const alpha = mix(
        mix(float(0.7), float(0.35), notUnexplored),
        float(0.0),
        isVisible
      );

      const color = mix(unexploredColor, exploredColor, notUnexplored);

      return vec4(color, alpha);
    })();

    material.colorNode = outputNode;

    // Replace material
    this.material.dispose();
    this.material = material;
    this.mesh.material = material;

    debugShaders.log('[FogOfWar] Material rebuilt for GPU-direct sampling');
  }

  public setVisionSystem(visionSystem: VisionSystem): void {
    this.visionSystem = visionSystem;

    // Check if GPU vision is available
    const gpuCompute = visionSystem.getGPUVisionCompute();
    if (gpuCompute && gpuCompute.isAvailable() && gpuCompute.isUsingGPU()) {
      this.gpuVisionCompute = gpuCompute;
      this.enableGPUVision();
    }
  }

  public setPlayerId(playerId: string | null): void {
    this.playerId = playerId;

    if (playerId && this.visionSystem) {
      const knownPlayers = Array.from((this.visionSystem as any).knownPlayers || []);
      this.playerIndex = knownPlayers.indexOf(playerId);
      if (this.playerIndex === -1) this.playerIndex = 0;

      // If GPU vision is enabled, get the storage texture for this player
      if (this.useGPUVision && this.gpuVisionCompute) {
        this.bindGPUTextureForPlayer();
      }
    }
  }

  /**
   * Enable GPU vision mode
   */
  private enableGPUVision(): void {
    if (!this.gpuVisionCompute) return;

    this.useGPUVision = true;
    this.uUseGPUTexture.value = 1;

    debugShaders.log('[FogOfWar] GPU vision enabled');
  }

  /**
   * Bind the StorageTexture for the current player
   */
  private bindGPUTextureForPlayer(): void {
    if (!this.gpuVisionCompute) return;

    const storageTex = this.gpuVisionCompute.getVisionTexture(this.playerIndex);
    if (storageTex && storageTex !== this.gpuStorageTexture) {
      this.gpuStorageTexture = storageTex;
      // Rebuild material with the bound GPU texture
      this.rebuildMaterialWithGPUTexture();
    }
  }

  /**
   * Set GPU vision compute reference directly
   */
  public setGPUVisionCompute(gpuCompute: VisionCompute | null): void {
    this.gpuVisionCompute = gpuCompute;

    if (gpuCompute && gpuCompute.isAvailable() && gpuCompute.isUsingGPU()) {
      this.enableGPUVision();
      if (this.playerId) {
        this.bindGPUTextureForPlayer();
      }
    } else {
      this.useGPUVision = false;
      this.uUseGPUTexture.value = 0;
    }
  }

  public update(): void {
    if (!this.visionSystem) return;

    // In spectator mode, hide fog entirely
    if (isSpectatorMode() || !this.playerId) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // GPU path: nothing to do - shader samples StorageTexture directly
    // VisionCompute updates the StorageTexture via compute shader
    if (this.useGPUVision && this.gpuVisionCompute) {
      // No CPU work needed - GPU handles everything
      return;
    }

    // CPU fallback path with throttling
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    const visionGrid = this.visionSystem.getVisionGridForPlayer(this.playerId);
    if (!visionGrid) return;

    // Update CPU texture from vision grid
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const textureY = this.gridHeight - 1 - y;
        const i = textureY * this.gridWidth + x;
        const state = visionGrid[y]?.[x] ?? 'unexplored';

        let alpha: number;
        switch (state) {
          case 'visible':
            alpha = 0;
            break;
          case 'explored':
            alpha = 128;
            break;
          case 'unexplored':
          default:
            alpha = 255;
            break;
        }

        this.cpuTextureData[i * 4 + 3] = alpha;
      }
    }

    this.cpuFogTexture.needsUpdate = true;
  }

  /**
   * Check if GPU vision is active
   */
  public isUsingGPUVision(): boolean {
    return this.useGPUVision;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.cpuFogTexture.dispose();
    // Note: gpuStorageTexture is owned by VisionCompute, not disposed here
  }
}

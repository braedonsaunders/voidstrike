/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
/**
 * TSL Fog of War - Vision Texture Provider
 *
 * This class provides the vision texture for the post-processing FogOfWarPass.
 * The actual fog of war rendering is now handled by the post-processing pipeline
 * for superior visual quality (soft edges, desaturation, animated clouds, etc.)
 *
 * This class handles:
 * - GPU path: Provides StorageTexture reference from VisionCompute
 * - CPU fallback: Manages DataTexture for vision data when GPU unavailable
 * - Player ID management and vision system integration
 *
 * The legacy mesh-based overlay has been removed in favor of the post-process approach.
 */

import * as THREE from 'three';
import { VisionSystem, VISION_UNEXPLORED, VISION_EXPLORED, VISION_VISIBLE } from '@/engine/systems/VisionSystem';
import { VisionCompute } from '@/rendering/compute/VisionCompute';
import { isSpectatorMode } from '@/store/gameSetupStore';
import { getConsoleEngineSync } from '@/engine/debug/ConsoleEngine';
import { debugShaders } from '@/utils/debugLogger';
import { clamp } from '@/utils/math';
import { gridToTextureIndex } from '@/rendering/vision/VisionCoordinates';

export interface TSLFogOfWarConfig {
  mapWidth: number;
  mapHeight: number;
  cellSize?: number;
}

export class TSLFogOfWar {
  private mapWidth: number;
  private mapHeight: number;
  private cellSize: number;
  private gridWidth: number;
  private gridHeight: number;

  // CPU fallback: DataTexture for vision data
  // Format: RGBA where R=explored, G=visible, B=velocity, A=smooth
  private cpuFogTexture: THREE.DataTexture;
  private cpuTextureData: Uint8Array;
  private prevVisibility: Float32Array; // For CPU temporal smoothing

  // GPU path: StorageTexture reference from VisionCompute
  private gpuStorageTexture: THREE.Texture | null = null;

  private visionSystem: VisionSystem | null = null;
  private playerId: string | null = null;
  private playerIndex: number = 0;

  // GPU Vision Compute reference
  private gpuVisionCompute: VisionCompute | null = null;
  private useGPUVision: boolean = false;

  // Throttle CPU updates
  private lastUpdateTime: number = 0;
  private updateInterval: number = 50; // ms - faster for smoother transitions

  // Temporal smoothing for CPU path
  private temporalBlendSpeed: number = 0.15;

  // Track enabled state
  private enabled: boolean = true;

  constructor(config: TSLFogOfWarConfig) {
    this.mapWidth = config.mapWidth;
    this.mapHeight = config.mapHeight;
    this.cellSize = config.cellSize ?? 2;
    this.gridWidth = Math.ceil(this.mapWidth / this.cellSize);
    this.gridHeight = Math.ceil(this.mapHeight / this.cellSize);

    // Create CPU fallback texture - RGBA format matching GPU output
    this.cpuTextureData = new Uint8Array(this.gridWidth * this.gridHeight * 4);
    this.prevVisibility = new Float32Array(this.gridWidth * this.gridHeight);

    // Initialize to fully unexplored
    for (let i = 0; i < this.gridWidth * this.gridHeight; i++) {
      this.cpuTextureData[i * 4 + 0] = 0;   // R - explored
      this.cpuTextureData[i * 4 + 1] = 0;   // G - visible
      this.cpuTextureData[i * 4 + 2] = 128; // B - velocity (0.5 = no change)
      this.cpuTextureData[i * 4 + 3] = 0;   // A - smooth visibility
      this.prevVisibility[i] = 0;
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
    this.cpuFogTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.cpuFogTexture.wrapT = THREE.ClampToEdgeWrapping;

    debugShaders.log(`[FogOfWar] Initialized as texture provider (${this.gridWidth}x${this.gridHeight} grid)`);
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
      debugShaders.log('[FogOfWar] GPU texture bound for player', this.playerIndex);
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
      this.gpuStorageTexture = null;
    }
  }

  /**
   * Update the fog of war texture
   * For GPU path, this just binds the latest texture
   * For CPU path, this updates the DataTexture with temporal smoothing
   */
  public update(): void {
    if (!this.visionSystem || !this.enabled) return;

    // In spectator mode, fog is disabled
    if (isSpectatorMode() || !this.playerId) {
      return;
    }

    // Check if fog is disabled via debug console
    const consoleEngine = getConsoleEngineSync();
    if (consoleEngine?.getFlag('fogDisabled')) {
      return;
    }

    // GPU path: just ensure we have the latest texture bound
    if (this.useGPUVision && this.gpuVisionCompute) {
      this.bindGPUTextureForPlayer();
      return;
    }

    // CPU fallback path with throttling and temporal smoothing
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    const visionGrid = this.visionSystem.getVisionGridForPlayer(this.playerId);
    if (!visionGrid) return;

    // Update CPU texture from vision grid with temporal smoothing
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        // Use shared coordinate mapping (no Y-flip, matches GPU path)
        const i = gridToTextureIndex(x, y, this.gridWidth);
        const state = visionGrid[y]?.[x] ?? 'unexplored';

        // Current visibility (target)
        let targetVisible: number;
        let targetExplored: number;

        switch (state) {
          case 'visible':
            targetVisible = 1.0;
            targetExplored = 1.0;
            break;
          case 'explored':
            targetVisible = 0.0;
            targetExplored = 1.0;
            break;
          case 'unexplored':
          default:
            targetVisible = 0.0;
            targetExplored = 0.0;
            break;
        }

        // Temporal smoothing
        const prevSmooth = this.prevVisibility[i];
        const newSmooth = prevSmooth + (targetVisible - prevSmooth) * this.temporalBlendSpeed;
        this.prevVisibility[i] = newSmooth;

        // Velocity (for edge effects)
        const velocity = (targetVisible - prevSmooth) * 0.5 + 0.5; // Normalized to 0-1

        // Write RGBA values (0-255)
        this.cpuTextureData[i * 4 + 0] = Math.round(targetExplored * 255); // R - explored
        this.cpuTextureData[i * 4 + 1] = Math.round(targetVisible * 255);  // G - visible
        this.cpuTextureData[i * 4 + 2] = Math.round(velocity * 255);       // B - velocity
        this.cpuTextureData[i * 4 + 3] = Math.round(newSmooth * 255);      // A - smooth
      }
    }

    this.cpuFogTexture.needsUpdate = true;
  }

  /**
   * Update from serialized vision data (for worker mode)
   * This method is used when vision data comes from RenderState instead of VisionSystem
   * @param serializedData Uint8Array with vision states (0=unexplored, 1=explored, 2=visible)
   */
  public updateFromSerializedData(serializedData: Uint8Array): void {
    if (!this.enabled || !this.playerId) return;

    // In spectator mode, fog is disabled
    if (isSpectatorMode()) {
      return;
    }

    // Check if fog is disabled via debug console
    const consoleEngine = getConsoleEngineSync();
    if (consoleEngine?.getFlag('fogDisabled')) {
      return;
    }

    // Throttle updates
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    // Verify data size matches grid
    const expectedSize = this.gridWidth * this.gridHeight;
    if (serializedData.length !== expectedSize) {
      debugShaders.warn(`[FogOfWar] Serialized data size mismatch: expected ${expectedSize}, got ${serializedData.length}`);
      return;
    }

    // Update CPU texture from serialized data with temporal smoothing
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        // Use shared coordinate mapping (no Y-flip, matches GPU path)
        const textureIndex = gridToTextureIndex(x, y, this.gridWidth);
        const dataIndex = y * this.gridWidth + x;
        const state = serializedData[dataIndex];

        // Current visibility (target)
        let targetVisible: number;
        let targetExplored: number;

        switch (state) {
          case VISION_VISIBLE:
            targetVisible = 1.0;
            targetExplored = 1.0;
            break;
          case VISION_EXPLORED:
            targetVisible = 0.0;
            targetExplored = 1.0;
            break;
          case VISION_UNEXPLORED:
          default:
            targetVisible = 0.0;
            targetExplored = 0.0;
            break;
        }

        // Temporal smoothing
        const prevSmooth = this.prevVisibility[textureIndex];
        const newSmooth = prevSmooth + (targetVisible - prevSmooth) * this.temporalBlendSpeed;
        this.prevVisibility[textureIndex] = newSmooth;

        // Velocity (for edge effects)
        const velocity = (targetVisible - prevSmooth) * 0.5 + 0.5; // Normalized to 0-1

        // Write RGBA values (0-255)
        this.cpuTextureData[textureIndex * 4 + 0] = Math.round(targetExplored * 255); // R - explored
        this.cpuTextureData[textureIndex * 4 + 1] = Math.round(targetVisible * 255);  // G - visible
        this.cpuTextureData[textureIndex * 4 + 2] = Math.round(velocity * 255);       // B - velocity
        this.cpuTextureData[textureIndex * 4 + 3] = Math.round(newSmooth * 255);      // A - smooth
      }
    }

    this.cpuFogTexture.needsUpdate = true;
  }

  /**
   * Get the current vision texture
   * Returns GPU StorageTexture if available, otherwise CPU DataTexture
   */
  public getVisionTexture(): THREE.Texture | null {
    if (!this.enabled) return null;

    if (isSpectatorMode() || !this.playerId) {
      return null;
    }

    // Check if fog is disabled via debug console
    const consoleEngine = getConsoleEngineSync();
    if (consoleEngine?.getFlag('fogDisabled')) {
      return null;
    }

    // GPU path
    if (this.useGPUVision && this.gpuStorageTexture) {
      return this.gpuStorageTexture;
    }

    // CPU fallback
    return this.cpuFogTexture;
  }

  /**
   * Check if GPU vision is active
   */
  public isUsingGPUVision(): boolean {
    return this.useGPUVision;
  }

  /**
   * Get grid dimensions
   */
  public getGridDimensions(): { width: number; height: number; cellSize: number } {
    return {
      width: this.gridWidth,
      height: this.gridHeight,
      cellSize: this.cellSize,
    };
  }

  /**
   * Get map dimensions
   */
  public getMapDimensions(): { width: number; height: number } {
    return {
      width: this.mapWidth,
      height: this.mapHeight,
    };
  }

  /**
   * Set temporal blend speed (0-1, higher = faster transitions)
   */
  public setTemporalBlendSpeed(speed: number): void {
    this.temporalBlendSpeed = clamp(speed, 0.01, 1.0);
  }

  /**
   * Enable or disable fog of war
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get player index
   */
  public getPlayerIndex(): number {
    return this.playerIndex;
  }

  public dispose(): void {
    this.cpuFogTexture.dispose();
    // Note: gpuStorageTexture is owned by VisionCompute, not disposed here
  }
}

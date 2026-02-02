/**
 * GPU Compute Vision System
 *
 * Moves fog of war computation from CPU to GPU compute shaders using TSL.
 * Each GPU thread handles one grid cell, checking visibility against all vision casters.
 *
 * Performance: 1000+ vision casters at 60Hz instead of hundreds at 2Hz.
 *
 * COORDINATE SYSTEM (must match CPU fallback in FogOfWar.ts):
 * - See VisionCoordinates.ts for shared coordinate mapping utilities
 * - caster.x = world X (horizontal)
 * - caster.y = game's transform.y (depth/north-south, NOT altitude)
 * - Grid cell (cellX, cellY) maps to texture pixel (cellX, cellY) - NO Y-FLIP
 * - Fog shader (EffectPasses.ts): uses Three.js worldZ for depth after camera reconstruction
 *   (Game transform.y → Three.js position.z → worldZ in shader)
 *
 * Architecture:
 * - Storage buffer: Unit positions + sight ranges packed as vec4(x, y, sightRadius, playerId)
 * - Storage texture: RGBA per cell per player
 *   - R = explored flag (0 or 1, persists once seen)
 *   - G = visible flag (0 or 1, current frame)
 *   - B = visibility velocity (change rate for edge effects)
 *   - A = smooth visibility (temporally filtered for smooth transitions)
 * - Workgroup size: 64 threads
 * - Ping-pong buffers for temporal accumulation
 * - FogOfWar shader samples StorageTexture directly (no CPU readback)
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  storage,
  uniform,
  vec2,
  vec4,
  float,
  int,
  Loop,
  If,
  instanceIndex,
  textureStore,
  texture,
  max,
} from 'three/tsl';

import { debugShaders } from '@/utils/debugLogger';
import { clamp } from '@/utils/math';

/**
 * StorageTexture class for GPU compute shaders.
 *
 * Three.js r182+ includes StorageTexture but doesn't export it as a named export.
 * We access it via the THREE namespace at runtime. The class extends THREE.Texture.
 *
 * @see three-webgpu.d.ts for type declaration
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StorageTexture: new (width: number, height: number) => THREE.Texture = (THREE as any)
  .StorageTexture;

// Max casters per compute dispatch
const MAX_CASTERS = 4096;

// Workgroup size for vision compute
const WORKGROUP_SIZE = 64;

// Temporal smoothing factor (higher = faster transitions)
const TEMPORAL_BLEND_SPEED = 0.15;

export interface VisionCaster {
  x: number;
  y: number;
  sightRange: number;
  playerId: number;
}

export interface VisionComputeConfig {
  mapWidth: number;
  mapHeight: number;
  cellSize: number;
}

/**
 * Internal type for compute shader node cache.
 *
 * TSL compute nodes are created dynamically via Fn().compute() and lack
 * official TypeScript declarations. The compute node type is opaque -
 * it's passed to renderer.compute() which handles dispatch internally.
 */
interface ComputeNodeCache {
  /** Compute node writing A, reading B */
  nodeAB: unknown;
  /** Compute node writing B, reading A */
  nodeBA: unknown;
}

export class VisionCompute {
  private renderer: WebGPURenderer;
  private config: VisionComputeConfig;

  private gridWidth: number;
  private gridHeight: number;

  // GPU storage textures per player - ping-pong for temporal accumulation
  // Format: RGBA where R=explored, G=visible, B=velocity, A=smooth visibility
  private visionTexturesA: Map<number, THREE.Texture> = new Map();
  private visionTexturesB: Map<number, THREE.Texture> = new Map();
  private currentBufferIsA: Map<number, boolean> = new Map();

  // Caster storage buffer
  private casterData: Float32Array;
  private casterStorageBuffer: ReturnType<typeof storage> | null = null;

  // Compute shader nodes per player
  private computeNodes: Map<number, ComputeNodeCache> = new Map();

  // Uniforms
  private uGridWidth = uniform(0);
  private uGridHeight = uniform(0);
  private uCellSize = uniform(1);
  private uCasterCount = uniform(0);
  private uTargetPlayerId = uniform(0);
  private uTemporalBlend = uniform(TEMPORAL_BLEND_SPEED);
  private uDeltaTime = uniform(0.016); // ~60fps default

  // State tracking
  private gpuComputeAvailable = false;
  private gpuComputeVerified = false;
  private useCPUFallback = false;
  private visionVersion = 0;

  // Performance metrics
  private gpuDispatchCount = 0;
  private lastGPUDispatchTime = 0;

  constructor(renderer: WebGPURenderer, config: VisionComputeConfig) {
    this.renderer = renderer;
    this.config = config;

    this.gridWidth = Math.ceil(config.mapWidth / config.cellSize);
    this.gridHeight = Math.ceil(config.mapHeight / config.cellSize);

    this.casterData = new Float32Array(MAX_CASTERS * 4);

    this.initializeResources();
  }

  private initializeResources(): void {
    try {
      if (!this.renderer || typeof this.renderer.compute !== 'function') {
        throw new Error('Renderer does not support compute shaders');
      }

      this.uGridWidth.value = this.gridWidth;
      this.uGridHeight.value = this.gridHeight;
      this.uCellSize.value = this.config.cellSize;

      this.casterStorageBuffer = storage(this.casterData, 'vec4', MAX_CASTERS);

      this.gpuComputeAvailable = true;
      this.useCPUFallback = false;

      debugShaders.log(
        `[VisionCompute] GPU compute initialized (${this.gridWidth}x${this.gridHeight} grid)`
      );
      debugShaders.log('[GPU Vision] INITIALIZED with temporal smoothing');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debugShaders.warn('[VisionCompute] GPU compute not available:', errorMsg);
      this.gpuComputeAvailable = false;
      this.useCPUFallback = true;
      debugShaders.warn('[GPU Vision] INIT FAILED:', errorMsg);
    }
  }

  /**
   * Create GPU compute shader for vision calculation with temporal smoothing.
   *
   * Output format (RGBA):
   * - R: explored (0 or 1) - persists once area is seen
   * - G: visible (0 or 1) - current frame visibility
   * - B: velocity (signed) - rate of visibility change for edge effects
   * - A: smooth visibility (0-1) - temporally filtered for smooth transitions
   *
   * @returns TSL compute node ready for dispatch via renderer.compute()
   */
  private createComputeShader(
    currentTexture: THREE.Texture,
    previousTexture: THREE.Texture
  ): unknown {
    const gridWidth = this.uGridWidth;
    const gridHeight = this.uGridHeight;
    const cellSize = this.uCellSize;
    const casterCount = this.uCasterCount;
    const targetPlayerId = this.uTargetPlayerId;
    const casterBuffer = this.casterStorageBuffer!;
    const temporalBlend = this.uTemporalBlend;

    const computeVision = Fn(() => {
      const cellIndex = instanceIndex;
      const cellX = cellIndex.mod(gridWidth);
      const cellY = cellIndex.div(gridWidth);

      // Early exit if out of bounds
      If(cellIndex.greaterThanEqual(gridWidth.mul(gridHeight)), () => {
        return;
      });

      // Cell center in world coordinates
      const worldX = cellX.toFloat().mul(cellSize).add(cellSize.mul(0.5));
      const worldY = cellY.toFloat().mul(cellSize).add(cellSize.mul(0.5));

      // Read previous frame's data for temporal accumulation
      const prevUV = vec2(
        cellX.toFloat().add(0.5).div(gridWidth),
        cellY.toFloat().add(0.5).div(gridHeight)
      );
      const prevData = texture(previousTexture).sample(prevUV);
      const prevExplored = prevData.r;
      const prevSmooth = prevData.a;

      // Track visibility for current frame
      const isVisible = float(0).toVar();

      // Check against all casters
      const i = int(0).toVar();
      Loop(casterCount, () => {
        const caster = casterBuffer.element(i);
        const casterX = caster.x;
        const casterY = caster.y;
        const sightRange = caster.z;
        const casterPlayer = caster.w.toInt();

        const dx = worldX.sub(casterX);
        const dy = worldY.sub(casterY);
        const distSq = dx.mul(dx).add(dy.mul(dy));
        const rangeSq = sightRange.mul(sightRange);

        If(distSq.lessThanEqual(rangeSq).and(casterPlayer.equal(targetPlayerId)), () => {
          isVisible.assign(1.0);
        });

        i.addAssign(1);
      });

      // ============================================
      // TEMPORAL SMOOTHING
      // ============================================
      // Smooth visibility transitions over time
      // new_smooth = lerp(prev_smooth, current_visible, blend_speed)
      const targetSmooth = isVisible;
      const newSmooth = prevSmooth.add(targetSmooth.sub(prevSmooth).mul(temporalBlend));

      // Visibility velocity (for edge glow effects)
      // Positive = becoming visible, Negative = becoming hidden
      const velocity = targetSmooth.sub(prevSmooth);

      // Explored flag - once seen, always explored
      const newExplored = max(prevExplored, isVisible);

      // ============================================
      // WRITE OUTPUT
      // ============================================
      // R = explored (persists)
      // G = visible (current frame, binary)
      // B = velocity (change rate, signed)
      // A = smooth (temporally filtered 0-1)
      textureStore(
        currentTexture,
        vec2(cellX, cellY),
        vec4(newExplored, isVisible, velocity.mul(0.5).add(0.5), newSmooth)
      );
    });

    const totalCells = this.gridWidth * this.gridHeight;
    return computeVision().compute(totalCells, [WORKGROUP_SIZE]);
  }

  /**
   * Get or create storage textures for a player (ping-pong pair)
   */
  private getOrCreateStorageTextures(playerId: number): {
    current: THREE.Texture;
    previous: THREE.Texture;
  } {
    let texA = this.visionTexturesA.get(playerId);
    let texB = this.visionTexturesB.get(playerId);

    if (!texA || !texB) {
      // Create ping-pong pair
      texA = new StorageTexture(this.gridWidth, this.gridHeight) as THREE.Texture;
      texA.type = THREE.FloatType;
      texA.format = THREE.RGBAFormat;
      texA.minFilter = THREE.LinearFilter; // Linear for smooth sampling
      texA.magFilter = THREE.LinearFilter;
      texA.wrapS = THREE.ClampToEdgeWrapping;
      texA.wrapT = THREE.ClampToEdgeWrapping;

      texB = new StorageTexture(this.gridWidth, this.gridHeight) as THREE.Texture;
      texB.type = THREE.FloatType;
      texB.format = THREE.RGBAFormat;
      texB.minFilter = THREE.LinearFilter;
      texB.magFilter = THREE.LinearFilter;
      texB.wrapS = THREE.ClampToEdgeWrapping;
      texB.wrapT = THREE.ClampToEdgeWrapping;

      this.visionTexturesA.set(playerId, texA);
      this.visionTexturesB.set(playerId, texB);
      this.currentBufferIsA.set(playerId, true);

      // Create compute node for this player
      const computeNode = this.createComputeShader(texA, texB);
      this.computeNodes.set(playerId, { nodeAB: computeNode, nodeBA: null });
    }

    const isA = this.currentBufferIsA.get(playerId) ?? true;
    return {
      current: isA ? texA! : texB!,
      previous: isA ? texB! : texA!,
    };
  }

  /**
   * Check if GPU compute is available
   */
  public isAvailable(): boolean {
    return this.gpuComputeAvailable;
  }

  /**
   * Check if using GPU compute (vs CPU fallback)
   */
  public isUsingGPU(): boolean {
    return this.gpuComputeAvailable && !this.useCPUFallback;
  }

  /**
   * Check if GPU compute has been verified to work
   */
  public isGPUVerified(): boolean {
    return this.gpuComputeVerified;
  }

  /**
   * Get performance statistics
   */
  public getStats(): {
    gpuEnabled: boolean;
    gpuVerified: boolean;
    dispatchCount: number;
    lastDispatchTimeMs: number;
    gridCells: number;
  } {
    return {
      gpuEnabled: this.isUsingGPU(),
      gpuVerified: this.gpuComputeVerified,
      dispatchCount: this.gpuDispatchCount,
      lastDispatchTimeMs: this.lastGPUDispatchTime,
      gridCells: this.gridWidth * this.gridHeight,
    };
  }

  /**
   * Get current vision version for dirty checking
   */
  public getVisionVersion(): number {
    return this.visionVersion;
  }

  /**
   * Set temporal blend speed (0-1, higher = faster transitions)
   */
  public setTemporalBlendSpeed(speed: number): void {
    this.uTemporalBlend.value = clamp(speed, 0.01, 1.0);
  }

  /**
   * Update vision with new caster data
   */
  public updateVision(casters: VisionCaster[], playerIds: Set<number>, deltaTime?: number): void {
    if (casters.length === 0) return;

    if (deltaTime !== undefined) {
      this.uDeltaTime.value = deltaTime;
    }

    if (!this.gpuComputeAvailable || this.useCPUFallback) {
      // CPU fallback is handled by VisionSystem
      return;
    }

    this.computeVisionGPU(casters, playerIds);
    this.visionVersion++;
  }

  /**
   * GPU compute path with temporal smoothing
   */
  private computeVisionGPU(casters: VisionCaster[], playerIds: Set<number>): void {
    const startTime = performance.now();

    // Upload caster data
    const count = Math.min(casters.length, MAX_CASTERS);
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      this.casterData[offset + 0] = casters[i].x;
      this.casterData[offset + 1] = casters[i].y;
      this.casterData[offset + 2] = casters[i].sightRange;
      this.casterData[offset + 3] = casters[i].playerId;
    }

    this.uCasterCount.value = count;

    let dispatchedCount = 0;

    for (const playerId of playerIds) {
      const { current, previous } = this.getOrCreateStorageTextures(playerId);
      this.uTargetPlayerId.value = playerId;

      // Create compute node with current buffer configuration
      const isA = this.currentBufferIsA.get(playerId) ?? true;
      const computeNode = this.createComputeShader(current, previous);

      try {
        this.renderer.compute(computeNode);
        dispatchedCount++;

        // Swap buffers for next frame
        this.currentBufferIsA.set(playerId, !isA);

        if (!this.gpuComputeVerified) {
          this.gpuComputeVerified = true;
          debugShaders.log(
            `[VisionCompute] GPU compute verified with temporal smoothing (${count} casters)`
          );
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        debugShaders.warn('[VisionCompute] GPU compute failed:', errorMsg);
        this.useCPUFallback = true;
        this.gpuComputeVerified = false;
      }
    }

    this.gpuDispatchCount += dispatchedCount;
    this.lastGPUDispatchTime = performance.now() - startTime;
  }

  /**
   * Get vision storage texture for a player
   * Returns the current (most recent) StorageTexture that FogOfWar samples directly
   *
   * Texture format:
   * - R: explored (0-1)
   * - G: visible (0-1)
   * - B: velocity (0.5 = no change, <0.5 = hiding, >0.5 = revealing)
   * - A: smooth visibility (0-1, temporally filtered)
   */
  public getVisionTexture(playerId: number): THREE.Texture | null {
    const isA = this.currentBufferIsA.get(playerId);
    if (isA === undefined) return null;

    // Return the buffer that was just written (current)
    return isA
      ? (this.visionTexturesB.get(playerId) ?? null)
      : (this.visionTexturesA.get(playerId) ?? null);
  }

  /**
   * Reinitialize with new map dimensions
   */
  public reinitialize(config: VisionComputeConfig): void {
    this.config = config;
    this.gridWidth = Math.ceil(config.mapWidth / config.cellSize);
    this.gridHeight = Math.ceil(config.mapHeight / config.cellSize);

    this.uGridWidth.value = this.gridWidth;
    this.uGridHeight.value = this.gridHeight;
    this.uCellSize.value = config.cellSize;

    // Clear existing textures
    for (const tex of this.visionTexturesA.values()) {
      tex.dispose();
    }
    for (const tex of this.visionTexturesB.values()) {
      tex.dispose();
    }
    this.visionTexturesA.clear();
    this.visionTexturesB.clear();
    this.currentBufferIsA.clear();
    this.computeNodes.clear();

    this.visionVersion++;
  }

  /**
   * Get grid dimensions
   */
  public getGridDimensions(): { width: number; height: number; cellSize: number } {
    return {
      width: this.gridWidth,
      height: this.gridHeight,
      cellSize: this.config.cellSize,
    };
  }

  /**
   * Get map dimensions
   */
  public getMapDimensions(): { width: number; height: number } {
    return {
      width: this.config.mapWidth,
      height: this.config.mapHeight,
    };
  }

  /**
   * Force CPU fallback mode (for debugging)
   */
  public forceCPUFallback(enable: boolean): void {
    this.useCPUFallback = enable;
    debugShaders.log(`[VisionCompute] CPU fallback ${enable ? 'enabled' : 'disabled'}`);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    for (const tex of this.visionTexturesA.values()) {
      tex.dispose();
    }
    for (const tex of this.visionTexturesB.values()) {
      tex.dispose();
    }
    this.visionTexturesA.clear();
    this.visionTexturesB.clear();
    this.currentBufferIsA.clear();
    this.computeNodes.clear();
  }
}

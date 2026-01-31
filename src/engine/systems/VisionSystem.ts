import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Selectable } from '../components/Selectable';
import type { Game } from '../core/Game';
import { WatchTower } from '@/data/maps/MapTypes';
// GPU vision imports are lazy-loaded to avoid breaking worker context
// (WebGPU APIs are not available in Web Workers)
import type { VisionCompute, VisionCaster } from '@/rendering/compute/VisionCompute';
import type { WebGPURenderer } from 'three/webgpu';
import { debugPathfinding } from '@/utils/debugLogger';

// Vision states for fog of war
export type VisionState = 'unexplored' | 'explored' | 'visible';

// Vision state encoding for worker communication
const _VISION_UNEXPLORED = 0;
const VISION_EXPLORED = 1;
const VISION_VISIBLE = 2;

// Watch tower with activation state
export interface ActiveWatchTower extends WatchTower {
  id: number;
  isActive: boolean;
  controllingPlayers: Set<string>; // Players with units in range
}

// Temporary vision reveal (from scanner sweep, etc.)
export interface TemporaryReveal {
  playerId: string;
  position: { x: number; y: number };
  radius: number;
  expirationTick: number;
  detectsCloaked: boolean; // Whether this reveal can detect cloaked units
}

export interface VisionMap {
  width: number;
  height: number;
  cellSize: number;
  // Vision state per cell per player: Map<playerId, state[][]>
  playerVision: Map<string, VisionState[][]>;
  // Track which cells are currently visible (for performance)
  // OPTIMIZED: Use numeric keys (y * width + x) instead of string keys to avoid GC pressure
  currentlyVisible: Map<string, Set<number>>; // Set of numeric cell keys
}

export class VisionSystem extends System {
  public readonly name = 'VisionSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after MovementSystem)

  private visionMap!: VisionMap;
  private mapWidth: number;
  private mapHeight: number;
  private cellSize: number;
  // Dynamic player registration instead of hardcoded list
  private knownPlayers: Set<string> = new Set();

  // Watch towers (Xel'naga towers)
  private watchTowers: ActiveWatchTower[] = [];
  private readonly WATCH_TOWER_CAPTURE_RADIUS = 3; // Units within 3 units capture the tower

  // Temporary vision reveals (scanner sweep, etc.)
  private temporaryReveals: TemporaryReveal[] = [];

  // Throttle vision updates for performance - update every N ticks
  // PERF: Increased from 3 to 10 ticks (500ms at 20 TPS) - vision doesn't need 150ms precision
  private readonly UPDATE_INTERVAL = 10;
  private tickCounter = 0;

  // PERF: Version counter for dirty checking by FogOfWar renderer
  private visionVersion = 0;
  // PERF: Cached vision masks per player to avoid regenerating every frame
  private visionMaskCache: Map<string, { mask: Float32Array; width: number; height: number; version: number }> = new Map();

  // Web Worker for off-thread vision computation
  private visionWorker: Worker | null = null;
  private workerReady: boolean = false;
  private pendingWorkerUpdate: boolean = false;
  private lastWorkerVersion: number = 0;

  // GPU Compute for high-performance vision (WebGPU only)
  private gpuVisionCompute: VisionCompute | null = null;
  private useGPUVision: boolean = false;
  // Player ID to numeric index mapping for GPU
  private playerIdToIndex: Map<string, number> = new Map();
  private indexToPlayerId: Map<number, string> = new Map();

  // Track active computation path for debugging
  private activeComputePath: 'gpu' | 'worker' | 'main-thread' | null = null;

  constructor(game: Game, mapWidth: number, mapHeight: number, cellSize: number = 2) {
    super(game);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.cellSize = cellSize;
    this.initializeWorker();
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for vision-related events
   */
  private setupEventListeners(): void {
    // Listen for temporary vision reveals (scanner sweep, etc.)
    this.game.eventBus.on('vision:reveal', this.handleVisionReveal.bind(this));
  }

  /**
   * Handle vision:reveal event (from scanner sweep, etc.)
   */
  private handleVisionReveal(event: {
    playerId: string;
    position: { x: number; y: number };
    radius: number;
    duration: number;
  }): void {
    const currentTick = this.game.getCurrentTick();
    // Convert duration (seconds) to ticks (20 TPS)
    const durationTicks = Math.ceil(event.duration * 20);

    this.temporaryReveals.push({
      playerId: event.playerId,
      position: event.position,
      radius: event.radius,
      expirationTick: currentTick + durationTicks,
      detectsCloaked: true, // Scanner sweep detects cloaked units
    });

    debugPathfinding.log(
      `[VisionSystem] Added temporary reveal for ${event.playerId} at (${event.position.x.toFixed(1)}, ${event.position.y.toFixed(1)}) radius=${event.radius} for ${event.duration}s`
    );

    // Immediately reveal the area
    this.revealArea(event.playerId, event.position.x, event.position.y, event.radius);

    // Detect cloaked units in the area
    this.detectCloakedUnitsInArea(event.playerId, event.position, event.radius);

    // Increment version to trigger re-render
    this.visionVersion++;
  }

  /**
   * Initialize the vision web worker
   */
  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      debugPathfinding.warn('[VisionSystem] Web Workers not supported, using main thread fallback');
      return;
    }

    try {
      // Create worker as ES module (required for Next.js 16+ Turbopack)
      this.visionWorker = new Worker(
        new URL('../../workers/vision.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.visionWorker.onmessage = this.handleWorkerMessage.bind(this);
      this.visionWorker.onerror = (error) => {
        debugPathfinding.error('[VisionSystem] Worker error:', error);
        this.workerReady = false;
      };

      // Initialize worker with map dimensions
      this.visionWorker.postMessage({
        type: 'init',
        mapWidth: this.mapWidth,
        mapHeight: this.mapHeight,
        cellSize: this.cellSize,
      });

      debugPathfinding.log('[VisionSystem] Web Worker created');
    } catch (error) {
      debugPathfinding.warn('[VisionSystem] Failed to create worker:', error);
      this.visionWorker = null;
    }
  }

  /**
   * Handle messages from the vision worker
   */
  private handleWorkerMessage(event: MessageEvent): void {
    const message = event.data;

    switch (message.type) {
      case 'initialized':
        if (message.success) {
          this.workerReady = true;
          debugPathfinding.log('[VisionSystem] Worker initialized');
        } else {
          debugPathfinding.error('[VisionSystem] Worker init failed');
        }
        break;

      case 'visionResult':
        this.handleVisionResult(
          message.playerVisions,
          message.version,
          message.gridWidth,
          message.gridHeight
        );
        break;
    }
  }

  /**
   * Handle vision computation result from worker
   */
  private handleVisionResult(
    playerVisions: Record<string, Uint8Array>,
    version: number,
    gridWidth: number,
    gridHeight: number
  ): void {
    // Ignore stale results
    if (version <= this.lastWorkerVersion) {
      return;
    }
    this.lastWorkerVersion = version;
    this.pendingWorkerUpdate = false;

    // Update vision maps from worker data
    for (const [playerId, visionData] of Object.entries(playerVisions)) {
      this.ensurePlayerRegistered(playerId);

      const visionGrid = this.visionMap.playerVision.get(playerId)!;
      const currentVisible = this.visionMap.currentlyVisible.get(playerId)!;

      // Clear current visibility
      currentVisible.clear();

      // Convert Uint8Array to VisionState[][] and track visible cells
      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const index = y * gridWidth + x;
          const value = visionData[index];

          let state: VisionState;
          if (value === VISION_VISIBLE) {
            state = 'visible';
            currentVisible.add(index);
          } else if (value === VISION_EXPLORED) {
            state = 'explored';
          } else {
            state = 'unexplored';
          }

          if (visionGrid[y]) {
            visionGrid[y][x] = state;
          }
        }
      }
    }

    // Increment version for dirty checking by renderers
    this.visionVersion++;
  }

  /**
   * Initialize watch towers from map data
   */
  public setWatchTowers(towers: WatchTower[]): void {
    this.watchTowers = towers.map((tower, index) => ({
      ...tower,
      id: index,
      isActive: false,
      controllingPlayers: new Set<string>(),
    }));
  }

  /**
   * Get all watch towers with their current state
   */
  public getWatchTowers(): ActiveWatchTower[] {
    return this.watchTowers;
  }

  public init(world: World): void {
    super.init(world);
    this.initializeVisionMap();
  }

  /**
   * Reinitialize vision system with new map dimensions
   * Called when Game singleton receives new dimensions
   */
  public reinitialize(mapWidth: number, mapHeight: number): void {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.knownPlayers.clear();
    this.watchTowers = [];
    this.temporaryReveals = [];
    this.playerIdToIndex.clear();
    this.indexToPlayerId.clear();
    this.activeComputePath = null; // Reset to log path on next compute
    this.initializeVisionMap();

    // Reinitialize worker with new dimensions
    if (this.visionWorker && this.workerReady) {
      this.visionWorker.postMessage({
        type: 'init',
        mapWidth: this.mapWidth,
        mapHeight: this.mapHeight,
        cellSize: this.cellSize,
      });
    }

    // Reinitialize GPU vision compute with new dimensions
    if (this.gpuVisionCompute) {
      this.gpuVisionCompute.reinitialize({
        mapWidth: this.mapWidth,
        mapHeight: this.mapHeight,
        cellSize: this.cellSize,
      });
    }
  }

  private initializeVisionMap(): void {
    const gridWidth = Math.ceil(this.mapWidth / this.cellSize);
    const gridHeight = Math.ceil(this.mapHeight / this.cellSize);

    this.visionMap = {
      width: gridWidth,
      height: gridHeight,
      cellSize: this.cellSize,
      playerVision: new Map(),
      currentlyVisible: new Map(),
    };
    // Players will be registered dynamically when first encountered
  }

  /**
   * Register a player in the vision system if not already known
   */
  private ensurePlayerRegistered(playerId: string): void {
    if (this.knownPlayers.has(playerId)) return;

    // Create vision grid for this player
    const visionGrid: VisionState[][] = [];
    for (let y = 0; y < this.visionMap.height; y++) {
      visionGrid[y] = [];
      for (let x = 0; x < this.visionMap.width; x++) {
        visionGrid[y][x] = 'unexplored';
      }
    }
    this.visionMap.playerVision.set(playerId, visionGrid);
    this.visionMap.currentlyVisible.set(playerId, new Set());
    this.knownPlayers.add(playerId);
  }

  /**
   * Initialize GPU compute for vision (WebGPU only)
   * Call after WebGPU renderer is initialized
   * Uses dynamic import to avoid loading WebGPU code in worker context
   */
  public async initGPUVision(renderer: WebGPURenderer): Promise<void> {
    try {
      // Dynamic import to avoid loading WebGPU code in worker context
      const { VisionCompute } = await import('@/rendering/compute/VisionCompute');

      this.gpuVisionCompute = new VisionCompute(renderer, {
        mapWidth: this.mapWidth,
        mapHeight: this.mapHeight,
        cellSize: this.cellSize,
      });

      if (this.gpuVisionCompute.isAvailable()) {
        this.useGPUVision = true;
        debugPathfinding.log('[VisionSystem] GPU vision compute enabled');
      } else {
        debugPathfinding.warn('[VisionSystem] GPU vision not available, using worker fallback');
        this.gpuVisionCompute = null;
      }
    } catch (e) {
      debugPathfinding.warn('[VisionSystem] Failed to initialize GPU vision:', e);
      this.gpuVisionCompute = null;
    }
  }

  /**
   * Check if GPU vision is enabled
   */
  public isGPUVisionEnabled(): boolean {
    return this.useGPUVision && this.gpuVisionCompute !== null;
  }

  /**
   * Get the active vision computation path for debugging
   */
  public getActiveComputePath(): 'gpu' | 'worker' | 'main-thread' | null {
    return this.activeComputePath;
  }

  /**
   * Get the GPU vision compute instance (for FogOfWar to get textures)
   */
  public getGPUVisionCompute(): VisionCompute | null {
    return this.gpuVisionCompute;
  }

  /**
   * Get numeric player index for GPU (creates if not exists)
   */
  private getPlayerIndex(playerId: string): number {
    let index = this.playerIdToIndex.get(playerId);
    if (index === undefined) {
      index = this.playerIdToIndex.size;
      this.playerIdToIndex.set(playerId, index);
      this.indexToPlayerId.set(index, playerId);
    }
    return index;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.visionWorker) {
      this.visionWorker.terminate();
      this.visionWorker = null;
    }
    this.workerReady = false;
    this.pendingWorkerUpdate = false;
    this.temporaryReveals = [];

    if (this.gpuVisionCompute) {
      this.gpuVisionCompute.dispose();
      this.gpuVisionCompute = null;
    }
    this.useGPUVision = false;
  }

  public update(_deltaTime: number): void {
    // Throttle vision updates for performance
    this.tickCounter++;
    if (this.tickCounter < this.UPDATE_INTERVAL) {
      return; // Skip this tick
    }
    this.tickCounter = 0;

    this.computeVision();
  }

  /**
   * Force an immediate vision update regardless of game state or throttling.
   * Call this after spawning initial entities to ensure fog of war shows
   * correct visibility from the start (e.g., during countdown).
   */
  public forceUpdate(): void {
    this.computeVision();
  }

  /**
   * Compute vision using the best available method (GPU > Worker > Main Thread)
   */
  private computeVision(): void {
    // Priority: GPU > Worker > Main Thread
    if (this.useGPUVision && this.gpuVisionCompute) {
      if (this.activeComputePath !== 'gpu') {
        this.activeComputePath = 'gpu';
        debugPathfinding.log('[VisionSystem] Vision compute path: GPU');
      }
      this.updateVisionWithGPU();
    } else if (this.visionWorker && this.workerReady && !this.pendingWorkerUpdate) {
      if (this.activeComputePath !== 'worker') {
        this.activeComputePath = 'worker';
        debugPathfinding.log('[VisionSystem] Vision compute path: Worker');
      }
      this.updateVisionWithWorker();
    } else {
      if (this.activeComputePath !== 'main-thread') {
        this.activeComputePath = 'main-thread';
        debugPathfinding.log('[VisionSystem] Vision compute path: Main Thread (fallback)');
      }
      this.updateVisionMainThread();
    }
  }

  /**
   * Update vision using GPU compute
   */
  private updateVisionWithGPU(): void {
    if (!this.gpuVisionCompute) return;

    const casters: VisionCaster[] = [];

    // Collect unit data
    const unitEntities = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
    for (const entity of unitEntities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      if (!transform || !unit || !selectable) continue;

      this.ensurePlayerRegistered(selectable.playerId);
      const playerIndex = this.getPlayerIndex(selectable.playerId);

      casters.push({
        x: transform.x,
        y: transform.y,
        sightRange: unit.sightRange,
        playerId: playerIndex,
      });
    }

    // Collect building data
    const buildingEntities = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildingEntities) {
      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!transform || !building || !selectable) continue;
      if (!building.isOperational()) continue;

      this.ensurePlayerRegistered(selectable.playerId);
      const playerIndex = this.getPlayerIndex(selectable.playerId);

      casters.push({
        x: transform.x,
        y: transform.y,
        sightRange: building.sightRange,
        playerId: playerIndex,
      });
    }

    // Collect watch tower data
    this.updateWatchTowersGPU(casters, unitEntities);

    // Add temporary reveals as vision casters
    const currentTick = this.game.getCurrentTick();
    this.addTemporaryRevealCastersGPU(casters, currentTick);

    // Get player indices to update
    const playerIndices = new Set<number>();
    for (const playerId of this.knownPlayers) {
      playerIndices.add(this.getPlayerIndex(playerId));
    }

    // Update GPU vision
    this.gpuVisionCompute.updateVision(casters, playerIndices);

    // Sync GPU results back to CPU vision map for API compatibility
    this.syncGPUVisionToMap();

    this.visionVersion++;
  }

  /**
   * Update watch towers for GPU path
   */
  private updateWatchTowersGPU(casters: VisionCaster[], units: Entity[]): void {
    const captureRadiusSq = this.WATCH_TOWER_CAPTURE_RADIUS * this.WATCH_TOWER_CAPTURE_RADIUS;

    for (const tower of this.watchTowers) {
      tower.controllingPlayers.clear();
      tower.isActive = false;

      // Find units within capture radius
      for (const entity of units) {
        const transform = entity.get<Transform>('Transform');
        const selectable = entity.get<Selectable>('Selectable');
        if (!transform || !selectable) continue;

        const dx = transform.x - tower.x;
        const dy = transform.y - tower.y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= captureRadiusSq) {
          tower.controllingPlayers.add(selectable.playerId);
          tower.isActive = true;
        }
      }

      // Add watch tower as vision caster for controlling players
      if (tower.isActive) {
        for (const playerId of tower.controllingPlayers) {
          casters.push({
            x: tower.x,
            y: tower.y,
            sightRange: tower.radius,
            playerId: this.getPlayerIndex(playerId),
          });
        }
      }
    }
  }

  /**
   * Add temporary reveals as vision casters for GPU path
   */
  private addTemporaryRevealCastersGPU(casters: VisionCaster[], currentTick: number): void {
    // Remove expired reveals and add active ones as casters
    let i = 0;
    while (i < this.temporaryReveals.length) {
      const reveal = this.temporaryReveals[i];

      if (reveal.expirationTick <= currentTick) {
        // Expired - remove it (swap with last for O(1) removal)
        this.temporaryReveals[i] = this.temporaryReveals[this.temporaryReveals.length - 1];
        this.temporaryReveals.pop();
        // Don't increment i, check the swapped element
      } else {
        // Still active - add as vision caster
        this.ensurePlayerRegistered(reveal.playerId);
        casters.push({
          x: reveal.position.x,
          y: reveal.position.y,
          sightRange: reveal.radius,
          playerId: this.getPlayerIndex(reveal.playerId),
        });

        // Detect cloaked units if this reveal can detect them
        if (reveal.detectsCloaked) {
          this.detectCloakedUnitsInArea(reveal.playerId, reveal.position, reveal.radius);
        }

        i++;
      }
    }
  }

  /**
   * Sync GPU vision results back to CPU vision map for API compatibility
   */
  private syncGPUVisionToMap(): void {
    if (!this.gpuVisionCompute) return;

    const gridWidth = this.visionMap.width;
    const gridHeight = this.visionMap.height;

    for (const playerId of this.knownPlayers) {
      const playerIndex = this.getPlayerIndex(playerId);
      const tex = this.gpuVisionCompute.getVisionTexture(playerIndex);
      if (!tex) continue;

      const data = tex.image.data as Uint8Array;
      const visionGrid = this.visionMap.playerVision.get(playerId);
      const currentVisible = this.visionMap.currentlyVisible.get(playerId);

      if (!visionGrid || !currentVisible) continue;

      currentVisible.clear();

      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const idx = (y * gridWidth + x) * 4;
          const explored = data[idx + 0];
          const visible = data[idx + 1];

          let state: VisionState;
          if (visible === VISION_VISIBLE) {
            state = 'visible';
            currentVisible.add(y * gridWidth + x);
          } else if (explored === VISION_EXPLORED) {
            state = 'explored';
          } else {
            state = 'unexplored';
          }

          if (visionGrid[y]) {
            visionGrid[y][x] = state;
          }
        }
      }
    }
  }

  /**
   * Send vision update request to worker
   */
  private updateVisionWithWorker(): void {
    // Collect unit data for worker
    const units: Array<{
      id: number;
      x: number;
      y: number;
      sightRange: number;
      playerId: string;
    }> = [];

    const unitEntities = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
    for (const entity of unitEntities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      if (!transform || !unit || !selectable) continue;

      // Register player if new
      this.ensurePlayerRegistered(selectable.playerId);

      units.push({
        id: entity.id,
        x: transform.x,
        y: transform.y,
        sightRange: unit.sightRange,
        playerId: selectable.playerId,
      });
    }

    // Collect building data for worker
    const buildings: Array<{
      id: number;
      x: number;
      y: number;
      sightRange: number;
      playerId: string;
      isOperational: boolean;
    }> = [];

    const buildingEntities = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildingEntities) {
      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!transform || !building || !selectable) continue;

      // Register player if new
      this.ensurePlayerRegistered(selectable.playerId);

      buildings.push({
        id: entity.id,
        x: transform.x,
        y: transform.y,
        sightRange: building.sightRange,
        playerId: selectable.playerId,
        isOperational: building.isOperational(),
      });
    }

    // Collect watch tower data
    const watchTowerData = this.watchTowers.map(tower => ({
      id: tower.id,
      x: tower.x,
      y: tower.y,
      radius: tower.radius,
    }));

    // Send to worker
    this.visionVersion++;
    this.pendingWorkerUpdate = true;

    this.visionWorker!.postMessage({
      type: 'updateVision',
      units,
      buildings,
      watchTowers: watchTowerData,
      watchTowerCaptureRadius: this.WATCH_TOWER_CAPTURE_RADIUS,
      players: Array.from(this.knownPlayers),
      version: this.visionVersion,
    });
  }

  /**
   * Main thread fallback for vision computation
   */
  private updateVisionMainThread(): void {
    // Clear currently visible cells
    const gridWidth = this.visionMap.width;
    const currentTick = this.game.getCurrentTick();

    for (const playerId of this.knownPlayers) {
      const currentVisible = this.visionMap.currentlyVisible.get(playerId);
      const visionGrid = this.visionMap.playerVision.get(playerId);

      if (!currentVisible || !visionGrid) continue;

      // Mark previously visible cells as 'explored'
      for (const cellKey of currentVisible) {
        const x = cellKey % gridWidth;
        const y = Math.floor(cellKey / gridWidth);
        if (visionGrid[y] && visionGrid[y][x] === 'visible') {
          visionGrid[y][x] = 'explored';
        }
      }
      currentVisible.clear();
    }

    // Update vision from all units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
    for (const entity of units) {
      this.updateEntityVision(entity);
    }

    // Update vision from all buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildings) {
      this.updateBuildingVision(entity);
    }

    // Update watch towers
    this.updateWatchTowers(units);

    // Process temporary reveals (scanner sweep, etc.)
    this.processTemporaryReveals(currentTick);

    // Increment version for dirty checking by renderers
    this.visionVersion++;
  }

  /**
   * Process temporary vision reveals - apply active ones and expire old ones
   */
  private processTemporaryReveals(currentTick: number): void {
    // Remove expired reveals and process active ones
    let i = 0;
    while (i < this.temporaryReveals.length) {
      const reveal = this.temporaryReveals[i];

      if (reveal.expirationTick <= currentTick) {
        // Expired - remove it (swap with last for O(1) removal)
        this.temporaryReveals[i] = this.temporaryReveals[this.temporaryReveals.length - 1];
        this.temporaryReveals.pop();
        // Don't increment i, check the swapped element
      } else {
        // Still active - apply the reveal
        this.revealArea(reveal.playerId, reveal.position.x, reveal.position.y, reveal.radius);

        // Detect cloaked units if this reveal can detect them
        if (reveal.detectsCloaked) {
          this.detectCloakedUnitsInArea(reveal.playerId, reveal.position, reveal.radius);
        }

        i++;
      }
    }
  }

  /**
   * Get the current vision version for dirty checking
   */
  public getVisionVersion(): number {
    return this.visionVersion;
  }

  /**
   * Update watch tower control and vision (main thread fallback)
   */
  private updateWatchTowers(_units: Entity[]): void {
    // Reset all tower controlling players
    for (const tower of this.watchTowers) {
      tower.controllingPlayers.clear();
      tower.isActive = false;
    }

    const captureRadiusSq = this.WATCH_TOWER_CAPTURE_RADIUS * this.WATCH_TOWER_CAPTURE_RADIUS;

    for (const tower of this.watchTowers) {
      const nearbyUnitIds = this.world.unitGrid.queryRadius(
        tower.x,
        tower.y,
        this.WATCH_TOWER_CAPTURE_RADIUS
      );

      for (const unitId of nearbyUnitIds) {
        const entity = this.world.getEntity(unitId);
        if (!entity) continue;

        const transform = entity.get<Transform>('Transform');
        const selectable = entity.get<Selectable>('Selectable');
        if (!transform || !selectable) continue;

        const dx = transform.x - tower.x;
        const dy = transform.y - tower.y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= captureRadiusSq) {
          tower.controllingPlayers.add(selectable.playerId);
          tower.isActive = true;
        }
      }
    }

    // Grant vision to controlling players
    for (const tower of this.watchTowers) {
      if (tower.isActive) {
        for (const playerId of tower.controllingPlayers) {
          this.revealArea(playerId, tower.x, tower.y, tower.radius);
        }
      }
    }
  }

  private updateEntityVision(entity: Entity): void {
    const transform = entity.get<Transform>('Transform');
    const unit = entity.get<Unit>('Unit');
    const selectable = entity.get<Selectable>('Selectable');

    if (!transform || !unit || !selectable) return;

    this.revealArea(selectable.playerId, transform.x, transform.y, unit.sightRange);
  }

  private updateBuildingVision(entity: Entity): void {
    const transform = entity.get<Transform>('Transform');
    const building = entity.get<Building>('Building');
    const selectable = entity.get<Selectable>('Selectable');

    if (!transform || !building || !selectable) return;

    // Only provide vision if building is operational
    if (!building.isOperational()) return;

    this.revealArea(selectable.playerId, transform.x, transform.y, building.sightRange);
  }

  private revealArea(playerId: string, worldX: number, worldY: number, range: number): void {
    this.ensurePlayerRegistered(playerId);

    const visionGrid = this.visionMap.playerVision.get(playerId)!;
    const currentVisible = this.visionMap.currentlyVisible.get(playerId)!;
    const gridWidth = this.visionMap.width;
    const gridHeight = this.visionMap.height;

    const cellX = Math.floor(worldX / this.cellSize);
    const cellY = Math.floor(worldY / this.cellSize);
    const cellRange = Math.ceil(range / this.cellSize);

    const cellRangeSq = cellRange * cellRange;

    for (let dy = -cellRange; dy <= cellRange; dy++) {
      for (let dx = -cellRange; dx <= cellRange; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq <= cellRangeSq) {
          const x = cellX + dx;
          const y = cellY + dy;

          if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
            visionGrid[y][x] = 'visible';
            currentVisible.add(y * gridWidth + x);
          }
        }
      }
    }
  }

  /**
   * Detect and mark cloaked units within an area (for scanner sweep, detectors, etc.)
   * Emits events for each detected cloaked unit.
   */
  private detectCloakedUnitsInArea(
    playerId: string,
    position: { x: number; y: number },
    radius: number
  ): void {
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
    const radiusSq = radius * radius;

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      // Only detect enemy cloaked units
      if (selectable.playerId === playerId) continue;
      if (!unit.isCloaked) continue;

      // Check if within detection radius
      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= radiusSq) {
        // Emit detection event
        this.game.eventBus.emit('unit:detected', {
          entityId: entity.id,
          detectedBy: playerId,
          position: { x: transform.x, y: transform.y },
        });

        debugPathfinding.log(
          `[VisionSystem] Detected cloaked unit ${entity.id} at (${transform.x.toFixed(1)}, ${transform.y.toFixed(1)})`
        );
      }
    }
  }

  // Public API for checking visibility

  public getVisionState(playerId: string, worldX: number, worldY: number): VisionState {
    const visionGrid = this.visionMap.playerVision.get(playerId);
    if (!visionGrid) return 'unexplored';

    const cellX = Math.floor(worldX / this.cellSize);
    const cellY = Math.floor(worldY / this.cellSize);

    if (cellX < 0 || cellX >= this.visionMap.width || cellY < 0 || cellY >= this.visionMap.height) {
      return 'unexplored';
    }

    return visionGrid[cellY][cellX];
  }

  public isVisible(playerId: string, worldX: number, worldY: number): boolean {
    return this.getVisionState(playerId, worldX, worldY) === 'visible';
  }

  public isExplored(playerId: string, worldX: number, worldY: number): boolean {
    const state = this.getVisionState(playerId, worldX, worldY);
    return state === 'visible' || state === 'explored';
  }

  public getVisionMap(): VisionMap {
    return this.visionMap;
  }

  public getVisionGridForPlayer(playerId: string): VisionState[][] | undefined {
    return this.visionMap.playerVision.get(playerId);
  }

  // For minimap rendering - get a downsampled vision mask
  public getVisionMask(playerId: string, targetWidth: number, targetHeight: number): Float32Array {
    const visionGrid = this.visionMap.playerVision.get(playerId);
    if (!visionGrid) return new Float32Array(targetWidth * targetHeight);

    // Check cache for existing mask
    const cacheKey = playerId;
    const cached = this.visionMaskCache.get(cacheKey);
    if (cached &&
        cached.width === targetWidth &&
        cached.height === targetHeight &&
        cached.version === this.visionVersion) {
      return cached.mask;
    }

    // Reuse existing array if dimensions match
    let mask: Float32Array;
    if (cached && cached.width === targetWidth && cached.height === targetHeight) {
      mask = cached.mask;
    } else {
      mask = new Float32Array(targetWidth * targetHeight);
    }

    const scaleX = this.visionMap.width / targetWidth;
    const scaleY = this.visionMap.height / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);

        const state = visionGrid[srcY]?.[srcX] ?? 'unexplored';

        // 0 = unexplored, 0.5 = explored, 1 = visible
        mask[y * targetWidth + x] =
          state === 'visible' ? 1.0 : state === 'explored' ? 0.5 : 0.0;
      }
    }

    // Update cache
    this.visionMaskCache.set(cacheKey, { mask, width: targetWidth, height: targetHeight, version: this.visionVersion });

    return mask;
  }
}

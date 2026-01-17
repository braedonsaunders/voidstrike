import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Selectable } from '../components/Selectable';
import { Game } from '../core/Game';
import { WatchTower } from '@/data/maps/MapTypes';

// Vision states for fog of war
export type VisionState = 'unexplored' | 'explored' | 'visible';

// Vision state encoding for worker communication
const VISION_UNEXPLORED = 0;
const VISION_EXPLORED = 1;
const VISION_VISIBLE = 2;

// Watch tower with activation state
export interface ActiveWatchTower extends WatchTower {
  id: number;
  isActive: boolean;
  controllingPlayers: Set<string>; // Players with units in range
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
  public priority = 5; // Run after movement

  private visionMap!: VisionMap;
  private mapWidth: number;
  private mapHeight: number;
  private cellSize: number;
  // Dynamic player registration instead of hardcoded list
  private knownPlayers: Set<string> = new Set();

  // Watch towers (Xel'naga towers)
  private watchTowers: ActiveWatchTower[] = [];
  private readonly WATCH_TOWER_CAPTURE_RADIUS = 3; // Units within 3 units capture the tower

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

  constructor(game: Game, mapWidth: number, mapHeight: number, cellSize: number = 2) {
    super(game);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.cellSize = cellSize;
    this.initializeWorker();
  }

  /**
   * Initialize the vision web worker
   */
  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      console.warn('[VisionSystem] Web Workers not supported, using main thread fallback');
      return;
    }

    try {
      // Create worker using Next.js compatible URL pattern
      this.visionWorker = new Worker(
        new URL('../../workers/vision.worker.ts', import.meta.url)
      );

      this.visionWorker.onmessage = this.handleWorkerMessage.bind(this);
      this.visionWorker.onerror = (error) => {
        console.error('[VisionSystem] Worker error:', error);
        this.workerReady = false;
      };

      // Initialize worker with map dimensions
      this.visionWorker.postMessage({
        type: 'init',
        mapWidth: this.mapWidth,
        mapHeight: this.mapHeight,
        cellSize: this.cellSize,
      });

      console.log('[VisionSystem] Web Worker created');
    } catch (error) {
      console.warn('[VisionSystem] Failed to create worker:', error);
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
          console.log('[VisionSystem] Worker initialized');
        } else {
          console.error('[VisionSystem] Worker init failed');
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
   * Clean up resources
   */
  public dispose(): void {
    if (this.visionWorker) {
      this.visionWorker.terminate();
      this.visionWorker = null;
    }
    this.workerReady = false;
    this.pendingWorkerUpdate = false;
  }

  public update(_deltaTime: number): void {
    // Throttle vision updates for performance
    this.tickCounter++;
    if (this.tickCounter < this.UPDATE_INTERVAL) {
      return; // Skip this tick
    }
    this.tickCounter = 0;

    // Use worker if available and no update is pending
    if (this.visionWorker && this.workerReady && !this.pendingWorkerUpdate) {
      this.updateVisionWithWorker();
    } else {
      // Fallback to main thread computation
      this.updateVisionMainThread();
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

    // Increment version for dirty checking by renderers
    this.visionVersion++;
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
  private updateWatchTowers(units: Entity[]): void {
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

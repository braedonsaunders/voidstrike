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

  constructor(game: Game, mapWidth: number, mapHeight: number, cellSize: number = 2) {
    super(game);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.cellSize = cellSize;
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

  public update(_deltaTime: number): void {
    // Throttle vision updates for performance
    this.tickCounter++;
    if (this.tickCounter < this.UPDATE_INTERVAL) {
      return; // Skip this tick
    }
    this.tickCounter = 0;

    // Clear currently visible cells
    // OPTIMIZED: Use numeric cell keys to avoid string allocation/parsing GC pressure
    const gridWidth = this.visionMap.width;

    for (const playerId of this.knownPlayers) {
      const currentVisible = this.visionMap.currentlyVisible.get(playerId);
      const visionGrid = this.visionMap.playerVision.get(playerId);

      // Skip if player not properly registered yet
      if (!currentVisible || !visionGrid) continue;

      // Mark previously visible cells as 'explored' (not 'visible')
      for (const cellKey of currentVisible) {
        // Decode numeric key back to x,y (no string parsing needed)
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

    // PERF: Increment version for dirty checking by renderers
    this.visionVersion++;
  }

  /**
   * Get the current vision version for dirty checking
   */
  public getVisionVersion(): number {
    return this.visionVersion;
  }

  /**
   * Update watch tower control and vision
   * PERF: Uses spatial grid queries per tower instead of O(units × towers) nested loop
   */
  private updateWatchTowers(units: Entity[]): void {
    // Reset all tower controlling players
    for (const tower of this.watchTowers) {
      tower.controllingPlayers.clear();
      tower.isActive = false;
    }

    // PERF: Pre-compute squared capture radius to avoid sqrt in distance checks
    const captureRadiusSq = this.WATCH_TOWER_CAPTURE_RADIUS * this.WATCH_TOWER_CAPTURE_RADIUS;

    // PERF: For each tower, query spatial grid for nearby units instead of checking all units
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

        // PERF: Use squared distance - no sqrt needed
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

    // Skip if components are missing (entity may have been modified during iteration)
    if (!transform || !unit || !selectable) return;

    this.revealArea(selectable.playerId, transform.x, transform.y, unit.sightRange);
  }

  private updateBuildingVision(entity: Entity): void {
    const transform = entity.get<Transform>('Transform');
    const building = entity.get<Building>('Building');
    const selectable = entity.get<Selectable>('Selectable');

    // Skip if components are missing (entity may have been modified during iteration)
    if (!transform || !building || !selectable) return;

    // Only provide vision if building is complete
    if (building.state !== 'complete') return;

    // Buildings have a base sight range
    const sightRange = 9;
    this.revealArea(selectable.playerId, transform.x, transform.y, sightRange);
  }

  private revealArea(playerId: string, worldX: number, worldY: number, range: number): void {
    // Dynamically register player if not known yet
    this.ensurePlayerRegistered(playerId);

    const visionGrid = this.visionMap.playerVision.get(playerId)!;
    const currentVisible = this.visionMap.currentlyVisible.get(playerId)!;
    const gridWidth = this.visionMap.width;
    const gridHeight = this.visionMap.height;

    const cellX = Math.floor(worldX / this.cellSize);
    const cellY = Math.floor(worldY / this.cellSize);
    const cellRange = Math.ceil(range / this.cellSize);

    // PERF: Pre-compute squared range to avoid sqrt in inner loop
    const cellRangeSq = cellRange * cellRange;

    // Reveal cells in a circle
    // OPTIMIZED: Use numeric cell keys (y * width + x) instead of string templates
    for (let dy = -cellRange; dy <= cellRange; dy++) {
      for (let dx = -cellRange; dx <= cellRange; dx++) {
        // PERF: Use squared distance - no sqrt needed
        const distSq = dx * dx + dy * dy;
        if (distSq <= cellRangeSq) {
          const x = cellX + dx;
          const y = cellY + dy;

          if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
            visionGrid[y][x] = 'visible';
            // Use numeric key: y * width + x (no string allocation)
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
  // PERF: Caches masks per player and only regenerates when vision changes
  public getVisionMask(playerId: string, targetWidth: number, targetHeight: number): Float32Array {
    const visionGrid = this.visionMap.playerVision.get(playerId);
    if (!visionGrid) return new Float32Array(targetWidth * targetHeight);

    // PERF: Check cache for existing mask
    const cacheKey = playerId;
    const cached = this.visionMaskCache.get(cacheKey);
    if (cached &&
        cached.width === targetWidth &&
        cached.height === targetHeight &&
        cached.version === this.visionVersion) {
      return cached.mask;
    }

    // PERF: Reuse existing array if dimensions match, otherwise allocate new
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

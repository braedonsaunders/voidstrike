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
  currentlyVisible: Map<string, Set<string>>; // Set of "x,y" keys
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
  private readonly UPDATE_INTERVAL = 3; // Update every 3 ticks instead of every tick
  private tickCounter = 0;

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
    for (const playerId of this.knownPlayers) {
      const currentVisible = this.visionMap.currentlyVisible.get(playerId);
      const visionGrid = this.visionMap.playerVision.get(playerId);

      // Skip if player not properly registered yet
      if (!currentVisible || !visionGrid) continue;

      // Mark previously visible cells as 'explored' (not 'visible')
      for (const key of currentVisible) {
        const [x, y] = key.split(',').map(Number);
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
  }

  /**
   * Update watch tower control and vision
   */
  private updateWatchTowers(units: Entity[]): void {
    // Reset all tower controlling players
    for (const tower of this.watchTowers) {
      tower.controllingPlayers.clear();
      tower.isActive = false;
    }

    // Check which players have units near each tower
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      for (const tower of this.watchTowers) {
        const dx = transform.x - tower.x;
        const dy = transform.y - tower.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= this.WATCH_TOWER_CAPTURE_RADIUS) {
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
    const transform = entity.get<Transform>('Transform')!;
    const unit = entity.get<Unit>('Unit')!;
    const selectable = entity.get<Selectable>('Selectable')!;

    this.revealArea(selectable.playerId, transform.x, transform.y, unit.sightRange);
  }

  private updateBuildingVision(entity: Entity): void {
    const transform = entity.get<Transform>('Transform')!;
    const building = entity.get<Building>('Building')!;
    const selectable = entity.get<Selectable>('Selectable')!;

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

    const cellX = Math.floor(worldX / this.cellSize);
    const cellY = Math.floor(worldY / this.cellSize);
    const cellRange = Math.ceil(range / this.cellSize);

    // Reveal cells in a circle
    for (let dy = -cellRange; dy <= cellRange; dy++) {
      for (let dx = -cellRange; dx <= cellRange; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= cellRange) {
          const x = cellX + dx;
          const y = cellY + dy;

          if (x >= 0 && x < this.visionMap.width && y >= 0 && y < this.visionMap.height) {
            visionGrid[y][x] = 'visible';
            currentVisible.add(`${x},${y}`);
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

    const mask = new Float32Array(targetWidth * targetHeight);
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

    return mask;
  }
}

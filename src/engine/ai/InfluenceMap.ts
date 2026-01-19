/**
 * Influence Map System for RTS AI
 *
 * Tracks spatial threat levels across the map grid. Used for:
 * - Strategic pathfinding (avoid dangerous areas)
 * - Expansion decisions (avoid enemy-controlled regions)
 * - Attack timing (identify weak points in enemy defenses)
 * - Retreat paths (find safe corridors)
 */

import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';

// Influence value type: positive = friendly, negative = enemy
export type InfluenceValue = number;

/**
 * Configuration for influence propagation
 */
export interface InfluenceConfig {
  /** Influence decay rate per cell distance */
  decayRate: number;
  /** Maximum propagation radius in cells */
  maxRadius: number;
  /** Base influence per unit supply */
  supplyInfluence: number;
  /** Building influence multiplier */
  buildingMultiplier: number;
  /** Defensive structure multiplier */
  defenseMultiplier: number;
  /** Air unit influence modifier (less ground threat) */
  airUnitModifier: number;
}

const DEFAULT_CONFIG: InfluenceConfig = {
  decayRate: 0.7, // 30% decay per cell
  maxRadius: 8,
  supplyInfluence: 5,
  buildingMultiplier: 2.0,
  defenseMultiplier: 3.0,
  airUnitModifier: 0.5,
};

/**
 * Cached influence data for a player
 */
interface PlayerInfluence {
  /** Grid of influence values */
  grid: Float32Array;
  /** Last update tick */
  lastUpdateTick: number;
  /** Total influence sum (for normalization) */
  totalInfluence: number;
}

/**
 * Threat analysis result for a position
 */
export interface ThreatAnalysis {
  /** Net influence at position (positive = friendly dominant) */
  netInfluence: number;
  /** Enemy influence at position */
  enemyInfluence: number;
  /** Friendly influence at position */
  friendlyInfluence: number;
  /** Danger level 0-1 (1 = very dangerous) */
  dangerLevel: number;
  /** Whether position is contested */
  isContested: boolean;
  /** Direction to safety (normalized) */
  safeDirection: { x: number; y: number };
}

/**
 * Influence Map - Tracks spatial threat/control across the map
 */
export class InfluenceMap {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly mapWidth: number;
  private readonly mapHeight: number;

  private config: InfluenceConfig;

  // Per-player influence grids
  private playerInfluence: Map<string, PlayerInfluence> = new Map();

  // Combined maps for quick lookups
  private threatMap: Float32Array; // Enemy threat from perspective of any player
  private controlMap: Float32Array; // Who controls each area (-1 to 1)

  // Update interval (ticks)
  private readonly updateInterval: number = 10;

  // Pre-computed decay lookup for performance
  private readonly decayLookup: Float32Array;

  constructor(mapWidth: number, mapHeight: number, cellSize: number = 4) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.cellSize = cellSize;
    this.cols = Math.ceil(mapWidth / cellSize);
    this.rows = Math.ceil(mapHeight / cellSize);
    this.config = { ...DEFAULT_CONFIG };

    const gridSize = this.cols * this.rows;
    this.threatMap = new Float32Array(gridSize);
    this.controlMap = new Float32Array(gridSize);

    // Pre-compute decay values for each distance
    const maxDist = this.config.maxRadius;
    this.decayLookup = new Float32Array(maxDist + 1);
    for (let d = 0; d <= maxDist; d++) {
      this.decayLookup[d] = Math.pow(this.config.decayRate, d);
    }
  }

  /**
   * Update the influence map for a given tick
   */
  public update(world: World, currentTick: number): void {
    // Clear combined maps
    this.threatMap.fill(0);
    this.controlMap.fill(0);

    // Get all units and buildings
    const entities = world.getEntitiesWith('Transform', 'Selectable', 'Health');

    // Group entities by player
    const playerEntities: Map<string, Array<{ x: number; y: number; influence: number; isAir: boolean }>> = new Map();

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (health.isDead()) continue;

      const playerId = selectable.playerId;
      if (!playerEntities.has(playerId)) {
        playerEntities.set(playerId, []);
      }

      // Calculate influence value
      let influence = 0;
      let isAir = false;

      const unit = entity.get<Unit>('Unit');
      const building = entity.get<Building>('Building');

      if (unit) {
        // Unit influence based on DPS and supply
        const dps = unit.attackDamage * unit.attackSpeed;
        influence = dps * 0.5 + this.config.supplyInfluence;
        isAir = unit.isFlying;

        // Reduce ground influence of air units
        if (isAir) {
          influence *= this.config.airUnitModifier;
        }
      } else if (building) {
        // Building influence
        influence = this.config.supplyInfluence * this.config.buildingMultiplier;

        // Defensive structures have more influence
        if (building.attackDamage > 0) {
          influence *= this.config.defenseMultiplier;
        }
      }

      playerEntities.get(playerId)!.push({
        x: transform.x,
        y: transform.y,
        influence,
        isAir,
      });
    }

    // Update each player's influence grid
    for (const [playerId, sources] of playerEntities) {
      this.updatePlayerInfluence(playerId, sources, currentTick);
    }

    // Build combined threat and control maps
    this.buildCombinedMaps();
  }

  /**
   * Update influence grid for a single player
   */
  private updatePlayerInfluence(
    playerId: string,
    sources: Array<{ x: number; y: number; influence: number; isAir: boolean }>,
    currentTick: number
  ): void {
    // Get or create player influence data
    let playerData = this.playerInfluence.get(playerId);
    if (!playerData) {
      playerData = {
        grid: new Float32Array(this.cols * this.rows),
        lastUpdateTick: 0,
        totalInfluence: 0,
      };
      this.playerInfluence.set(playerId, playerData);
    }

    // Clear grid
    playerData.grid.fill(0);
    playerData.totalInfluence = 0;

    // Propagate influence from each source
    for (const source of sources) {
      this.propagateInfluence(
        playerData.grid,
        source.x,
        source.y,
        source.influence
      );
      playerData.totalInfluence += source.influence;
    }

    playerData.lastUpdateTick = currentTick;
  }

  /**
   * Propagate influence from a source position
   */
  private propagateInfluence(
    grid: Float32Array,
    sourceX: number,
    sourceY: number,
    baseInfluence: number
  ): void {
    const centerCol = Math.floor(sourceX / this.cellSize);
    const centerRow = Math.floor(sourceY / this.cellSize);
    const maxRadius = this.config.maxRadius;

    const minCol = Math.max(0, centerCol - maxRadius);
    const maxCol = Math.min(this.cols - 1, centerCol + maxRadius);
    const minRow = Math.max(0, centerRow - maxRadius);
    const maxRow = Math.min(this.rows - 1, centerRow + maxRadius);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dx = col - centerCol;
        const dy = row - centerRow;
        const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));

        if (dist <= maxRadius) {
          const decay = this.decayLookup[dist];
          const index = row * this.cols + col;
          grid[index] += baseInfluence * decay;
        }
      }
    }
  }

  /**
   * Build combined threat and control maps from per-player data
   */
  private buildCombinedMaps(): void {
    const players = Array.from(this.playerInfluence.entries());
    if (players.length < 2) return;

    for (let i = 0; i < this.threatMap.length; i++) {
      let maxInfluence = 0;
      let totalInfluence = 0;
      let dominantPlayer: string | null = null;

      for (const [playerId, data] of players) {
        const influence = data.grid[i];
        totalInfluence += influence;
        if (influence > maxInfluence) {
          maxInfluence = influence;
          dominantPlayer = playerId;
        }
      }

      this.threatMap[i] = totalInfluence;

      // Control: -1 = player 1, +1 = player 2 (simplified for 2-player)
      if (totalInfluence > 0) {
        const [player1, player2] = players;
        const p1Influence = player1[1].grid[i];
        const p2Influence = player2 ? player2[1].grid[i] : 0;
        this.controlMap[i] = (p2Influence - p1Influence) / totalInfluence;
      }
    }
  }

  /**
   * Get threat analysis for a world position
   */
  public getThreatAnalysis(
    x: number,
    y: number,
    myPlayerId: string
  ): ThreatAnalysis {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return {
        netInfluence: 0,
        enemyInfluence: 0,
        friendlyInfluence: 0,
        dangerLevel: 0,
        isContested: false,
        safeDirection: { x: 0, y: 0 },
      };
    }

    const index = row * this.cols + col;

    // Get my influence
    const myData = this.playerInfluence.get(myPlayerId);
    const friendlyInfluence = myData ? myData.grid[index] : 0;

    // Calculate enemy influence (sum of all other players)
    let enemyInfluence = 0;
    for (const [playerId, data] of this.playerInfluence) {
      if (playerId !== myPlayerId) {
        enemyInfluence += data.grid[index];
      }
    }

    const netInfluence = friendlyInfluence - enemyInfluence;
    const totalInfluence = friendlyInfluence + enemyInfluence;

    // Calculate danger level (0-1)
    let dangerLevel = 0;
    if (totalInfluence > 0) {
      dangerLevel = Math.min(1, enemyInfluence / (totalInfluence + 10));
    }

    // Contested if both sides have significant presence
    const isContested = friendlyInfluence > 5 && enemyInfluence > 5;

    // Calculate safe direction (away from enemy influence gradient)
    const safeDirection = this.calculateSafeDirection(col, row, myPlayerId);

    return {
      netInfluence,
      enemyInfluence,
      friendlyInfluence,
      dangerLevel,
      isContested,
      safeDirection,
    };
  }

  /**
   * Calculate the direction toward safety (away from enemy influence)
   */
  private calculateSafeDirection(
    col: number,
    row: number,
    myPlayerId: string
  ): { x: number; y: number } {
    let gradX = 0;
    let gradY = 0;

    // Sample surrounding cells to find gradient
    const offsets = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];

    for (const [dx, dy] of offsets) {
      const nCol = col + dx;
      const nRow = row + dy;

      if (nCol < 0 || nCol >= this.cols || nRow < 0 || nRow >= this.rows) continue;

      const nIndex = nRow * this.cols + nCol;

      // Get enemy influence at neighbor
      let enemyInfluence = 0;
      for (const [playerId, data] of this.playerInfluence) {
        if (playerId !== myPlayerId) {
          enemyInfluence += data.grid[nIndex];
        }
      }

      // Move away from enemy influence (negative gradient)
      gradX -= dx * enemyInfluence;
      gradY -= dy * enemyInfluence;
    }

    // Normalize
    const mag = Math.sqrt(gradX * gradX + gradY * gradY);
    if (mag > 0.01) {
      gradX /= mag;
      gradY /= mag;
    }

    return { x: gradX, y: gradY };
  }

  /**
   * Find the safest path between two points (A* with threat avoidance)
   */
  public findSafePath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    myPlayerId: string,
    threatAvoidance: number = 1.0 // 0 = ignore threats, 1 = strongly avoid
  ): Array<{ x: number; y: number }> {
    const startCol = Math.floor(startX / this.cellSize);
    const startRow = Math.floor(startY / this.cellSize);
    const endCol = Math.floor(endX / this.cellSize);
    const endRow = Math.floor(endY / this.cellSize);

    // Simple A* with threat cost
    const openSet: Array<{ col: number; row: number; g: number; f: number; parent: number | null }> = [];
    const closedSet = new Set<number>();
    const cameFrom = new Map<number, number>();

    const startIndex = startRow * this.cols + startCol;
    const endIndex = endRow * this.cols + endCol;

    openSet.push({
      col: startCol,
      row: startRow,
      g: 0,
      f: this.heuristic(startCol, startRow, endCol, endRow),
      parent: null,
    });

    while (openSet.length > 0) {
      // Find lowest f score
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;
      const currentIndex = current.row * this.cols + current.col;

      if (currentIndex === endIndex) {
        // Reconstruct path
        return this.reconstructPath(cameFrom, currentIndex, startIndex);
      }

      closedSet.add(currentIndex);

      // Check neighbors
      const neighbors = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1],
      ];

      for (const [dx, dy] of neighbors) {
        const nCol = current.col + dx;
        const nRow = current.row + dy;

        if (nCol < 0 || nCol >= this.cols || nRow < 0 || nRow >= this.rows) continue;

        const nIndex = nRow * this.cols + nCol;
        if (closedSet.has(nIndex)) continue;

        // Calculate movement cost with threat penalty
        const moveCost = Math.abs(dx) + Math.abs(dy) === 2 ? 1.414 : 1.0;
        const threatCost = this.getThreatCost(nIndex, myPlayerId) * threatAvoidance;
        const totalCost = moveCost + threatCost;

        const tentativeG = current.g + totalCost;

        const existing = openSet.find(n => n.col === nCol && n.row === nRow);
        if (existing) {
          if (tentativeG < existing.g) {
            existing.g = tentativeG;
            existing.f = tentativeG + this.heuristic(nCol, nRow, endCol, endRow);
            cameFrom.set(nIndex, currentIndex);
          }
        } else {
          openSet.push({
            col: nCol,
            row: nRow,
            g: tentativeG,
            f: tentativeG + this.heuristic(nCol, nRow, endCol, endRow),
            parent: currentIndex,
          });
          cameFrom.set(nIndex, currentIndex);
        }
      }
    }

    // No path found, return direct path
    return [{ x: endX, y: endY }];
  }

  private heuristic(col1: number, row1: number, col2: number, row2: number): number {
    return Math.abs(col2 - col1) + Math.abs(row2 - row1);
  }

  private getThreatCost(index: number, myPlayerId: string): number {
    let enemyInfluence = 0;
    for (const [playerId, data] of this.playerInfluence) {
      if (playerId !== myPlayerId) {
        enemyInfluence += data.grid[index];
      }
    }
    // Scale threat to reasonable path cost
    return enemyInfluence * 0.1;
  }

  private reconstructPath(
    cameFrom: Map<number, number>,
    endIndex: number,
    startIndex: number
  ): Array<{ x: number; y: number }> {
    const path: Array<{ x: number; y: number }> = [];
    let current = endIndex;

    while (current !== startIndex) {
      const col = current % this.cols;
      const row = Math.floor(current / this.cols);
      path.unshift({
        x: (col + 0.5) * this.cellSize,
        y: (row + 0.5) * this.cellSize,
      });

      const prev = cameFrom.get(current);
      if (prev === undefined) break;
      current = prev;
    }

    return path;
  }

  /**
   * Find the best expansion location (low enemy influence, close to base)
   */
  public findBestExpansionArea(
    baseX: number,
    baseY: number,
    myPlayerId: string,
    searchRadius: number = 30
  ): { x: number; y: number; score: number } | null {
    const baseCol = Math.floor(baseX / this.cellSize);
    const baseRow = Math.floor(baseY / this.cellSize);
    const radiusCells = Math.ceil(searchRadius / this.cellSize);

    let bestScore = -Infinity;
    let bestPos: { x: number; y: number } | null = null;

    for (let dr = -radiusCells; dr <= radiusCells; dr++) {
      for (let dc = -radiusCells; dc <= radiusCells; dc++) {
        const col = baseCol + dc;
        const row = baseRow + dr;

        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) continue;

        const dist = Math.sqrt(dc * dc + dr * dr);
        if (dist < 5 || dist > radiusCells) continue; // Not too close, not too far

        const index = row * this.cols + col;

        // Get influences
        const myData = this.playerInfluence.get(myPlayerId);
        const friendly = myData ? myData.grid[index] : 0;

        let enemy = 0;
        for (const [playerId, data] of this.playerInfluence) {
          if (playerId !== myPlayerId) {
            enemy += data.grid[index];
          }
        }

        // Score: low enemy influence, moderate distance, some friendly presence nearby
        const score = -enemy * 2 - dist * 0.5 + friendly * 0.3;

        if (score > bestScore) {
          bestScore = score;
          bestPos = {
            x: (col + 0.5) * this.cellSize,
            y: (row + 0.5) * this.cellSize,
          };
        }
      }
    }

    return bestPos ? { ...bestPos, score: bestScore } : null;
  }

  /**
   * Get the enemy influence at a cell index
   */
  public getEnemyInfluenceAt(x: number, y: number, myPlayerId: string): number {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return 0;
    }

    const index = row * this.cols + col;
    let enemy = 0;

    for (const [playerId, data] of this.playerInfluence) {
      if (playerId !== myPlayerId) {
        enemy += data.grid[index];
      }
    }

    return enemy;
  }

  /**
   * Get cell size for external use
   */
  public getCellSize(): number {
    return this.cellSize;
  }

  /**
   * Get grid dimensions
   */
  public getDimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Clear all influence data
   */
  public clear(): void {
    this.playerInfluence.clear();
    this.threatMap.fill(0);
    this.controlMap.fill(0);
  }
}

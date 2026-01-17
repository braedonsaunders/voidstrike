/**
 * TerrainBrush - Terrain painting tools for the 3D editor
 *
 * Handles elevation painting, feature painting, and terrain sculpting.
 */

import type { EditorCell, EditorMapData, EditorConfig } from '../config/EditorConfig';

export interface BrushStroke {
  x: number;
  y: number;
  radius: number;
  intensity: number;
}

export interface CellUpdate {
  x: number;
  y: number;
  cell: Partial<EditorCell>;
}

export class TerrainBrush {
  private config: EditorConfig;
  private mapData: EditorMapData | null = null;

  constructor(config: EditorConfig) {
    this.config = config;
  }

  /**
   * Set current map data
   */
  public setMapData(mapData: EditorMapData): void {
    this.mapData = mapData;
  }

  /**
   * Paint elevation at position
   */
  public paintElevation(
    centerX: number,
    centerY: number,
    radius: number,
    targetElevation: number,
    walkable: boolean = true
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            updates.push({
              x,
              y,
              cell: {
                elevation: targetElevation,
                walkable,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Paint feature at position
   */
  public paintFeature(
    centerX: number,
    centerY: number,
    radius: number,
    feature: string
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;
    const featureConfig = this.config.terrain.features.find((f) => f.id === feature);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            updates.push({
              x,
              y,
              cell: {
                feature,
                walkable: featureConfig?.walkable ?? true,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Raise elevation at position
   */
  public raiseElevation(
    centerX: number,
    centerY: number,
    radius: number,
    amount: number = 10
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            const currentCell = this.mapData.terrain[y][x];
            // Falloff based on distance
            const falloff = 1 - Math.sqrt(distSq) / radius;
            const elevationChange = Math.round(amount * falloff);
            const newElevation = Math.min(255, currentCell.elevation + elevationChange);

            updates.push({
              x,
              y,
              cell: {
                elevation: newElevation,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Lower elevation at position
   */
  public lowerElevation(
    centerX: number,
    centerY: number,
    radius: number,
    amount: number = 10
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            const currentCell = this.mapData.terrain[y][x];
            const falloff = 1 - Math.sqrt(distSq) / radius;
            const elevationChange = Math.round(amount * falloff);
            const newElevation = Math.max(0, currentCell.elevation - elevationChange);

            updates.push({
              x,
              y,
              cell: {
                elevation: newElevation,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Smooth terrain at position
   */
  public smoothTerrain(
    centerX: number,
    centerY: number,
    radius: number
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            // Calculate average of neighbors
            let sum = 0;
            let count = 0;

            for (let ny = -1; ny <= 1; ny++) {
              for (let nx = -1; nx <= 1; nx++) {
                const sx = x + nx;
                const sy = y + ny;
                if (this.isInBounds(sx, sy)) {
                  sum += this.mapData.terrain[sy][sx].elevation;
                  count++;
                }
              }
            }

            const avgElevation = Math.round(sum / count);

            updates.push({
              x,
              y,
              cell: {
                elevation: avgElevation,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Flatten terrain to target elevation
   */
  public flattenTerrain(
    centerX: number,
    centerY: number,
    radius: number,
    targetElevation?: number
  ): CellUpdate[] {
    if (!this.mapData) return [];

    // If no target, use elevation at center
    const target = targetElevation ?? this.mapData.terrain[Math.floor(centerY)]?.[Math.floor(centerX)]?.elevation ?? 128;

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            updates.push({
              x,
              y,
              cell: {
                elevation: target,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Create plateau (flat raised area)
   */
  public createPlateau(
    centerX: number,
    centerY: number,
    radius: number,
    elevation: number,
    walkable: boolean = true
  ): CellUpdate[] {
    return this.paintElevation(centerX, centerY, radius, elevation, walkable);
  }

  /**
   * Erase to default values
   */
  public erase(centerX: number, centerY: number, radius: number): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            updates.push({
              x,
              y,
              cell: {
                elevation: this.config.terrain.defaultElevation,
                feature: this.config.terrain.defaultFeature,
                walkable: true,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Paint a ramp between two points
   * Creates a walkable gradient between different elevations
   */
  public paintRamp(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const visitedCells = new Set<string>();

    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return [];

    const steps = Math.ceil(length);
    const perpX = -dy / length;
    const perpY = dx / length;

    // Get elevations at endpoints
    const fromCell = this.mapData.terrain[Math.floor(fromY)]?.[Math.floor(fromX)];
    const toCell = this.mapData.terrain[Math.floor(toY)]?.[Math.floor(toX)];
    const fromElev = fromCell?.elevation ?? this.config.terrain.defaultElevation;
    const toElev = toCell?.elevation ?? this.config.terrain.defaultElevation;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = fromX + dx * t;
      const cy = fromY + dy * t;
      const elevation = Math.round(fromElev + (toElev - fromElev) * t);

      for (let w = -width / 2; w <= width / 2; w++) {
        const x = Math.floor(cx + perpX * w);
        const y = Math.floor(cy + perpY * w);
        const key = `${x},${y}`;

        if (this.isInBounds(x, y) && !visitedCells.has(key)) {
          visitedCells.add(key);
          updates.push({
            x,
            y,
            cell: {
              elevation,
              walkable: true,
            },
          });
        }
      }
    }

    return updates;
  }

  /**
   * Flood fill area with elevation
   */
  public floodFill(
    startX: number,
    startY: number,
    targetElevation: number,
    newElevation: number
  ): CellUpdate[] {
    if (!this.mapData) return [];
    if (!this.isInBounds(startX, startY)) return [];

    const updates: CellUpdate[] = [];
    const visited = new Set<string>();
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (!this.isInBounds(x, y)) continue;

      const cell = this.mapData.terrain[y][x];
      if (cell.elevation !== targetElevation) continue;

      visited.add(key);
      updates.push({ x, y, cell: { elevation: newElevation } });

      // Add neighbors
      queue.push({ x: x - 1, y });
      queue.push({ x: x + 1, y });
      queue.push({ x, y: y - 1 });
      queue.push({ x, y: y + 1 });
    }

    return updates;
  }

  /**
   * Check if coordinates are in bounds
   */
  private isInBounds(x: number, y: number): boolean {
    if (!this.mapData) return false;
    return x >= 0 && x < this.mapData.width && y >= 0 && y < this.mapData.height;
  }
}

export default TerrainBrush;

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
   * Paint a line between two points
   */
  public paintLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number,
    elevation: number,
    walkable: boolean = true
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const visitedCells = new Set<string>();

    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      // Single point
      return this.paintElevation(fromX, fromY, Math.ceil(width / 2), elevation, walkable);
    }

    const steps = Math.ceil(length);
    const perpX = -dy / length;
    const perpY = dx / length;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = fromX + dx * t;
      const cy = fromY + dy * t;

      for (let w = -width / 2; w <= width / 2; w++) {
        const x = Math.floor(cx + perpX * w);
        const y = Math.floor(cy + perpY * w);
        const key = `${x},${y}`;

        if (this.isInBounds(x, y) && !visitedCells.has(key)) {
          visitedCells.add(key);
          updates.push({
            x,
            y,
            cell: { elevation, walkable },
          });
        }
      }
    }

    return updates;
  }

  /**
   * Paint a filled rectangle
   */
  public paintRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    elevation: number,
    walkable: boolean = true,
    filled: boolean = true
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const minX = Math.min(Math.floor(x1), Math.floor(x2));
    const maxX = Math.max(Math.floor(x1), Math.floor(x2));
    const minY = Math.min(Math.floor(y1), Math.floor(y2));
    const maxY = Math.max(Math.floor(y1), Math.floor(y2));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!this.isInBounds(x, y)) continue;

        // If not filled, only draw border
        if (!filled) {
          const isBorder = x === minX || x === maxX || y === minY || y === maxY;
          if (!isBorder) continue;
        }

        updates.push({
          x,
          y,
          cell: { elevation, walkable },
        });
      }
    }

    return updates;
  }

  /**
   * Paint a filled ellipse
   */
  public paintEllipse(
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    elevation: number,
    walkable: boolean = true,
    filled: boolean = true
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const cx = Math.floor(centerX);
    const cy = Math.floor(centerY);
    const rx = Math.abs(radiusX);
    const ry = Math.abs(radiusY);

    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const x = cx + dx;
        const y = cy + dy;

        if (!this.isInBounds(x, y)) continue;

        // Check if point is inside ellipse: (dx/rx)^2 + (dy/ry)^2 <= 1
        const normalizedDist = (dx * dx) / (rx * rx || 1) + (dy * dy) / (ry * ry || 1);

        if (filled) {
          if (normalizedDist <= 1) {
            updates.push({ x, y, cell: { elevation, walkable } });
          }
        } else {
          // Border only: between 0.8 and 1.0 (adjustable thickness)
          if (normalizedDist <= 1 && normalizedDist >= 0.85) {
            updates.push({ x, y, cell: { elevation, walkable } });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Add noise/variation to elevation
   */
  public paintNoise(
    centerX: number,
    centerY: number,
    radius: number,
    intensity: number = 20,
    seed: number = Date.now()
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;

    // Simple seeded random
    const seededRandom = (x: number, y: number): number => {
      const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
      return n - Math.floor(n);
    };

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            const currentCell = this.mapData.terrain[y][x];
            const falloff = 1 - Math.sqrt(distSq) / radius;
            const noise = (seededRandom(x, y) - 0.5) * 2 * intensity * falloff;
            const newElevation = Math.max(0, Math.min(255, Math.round(currentCell.elevation + noise)));

            updates.push({
              x,
              y,
              cell: { elevation: newElevation },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Get cells for preview (returns positions without modifying)
   */
  public getLinePreview(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number
  ): Array<{ x: number; y: number }> {
    const positions: Array<{ x: number; y: number }> = [];
    const visitedCells = new Set<string>();

    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return [{ x: Math.floor(fromX), y: Math.floor(fromY) }];

    const steps = Math.ceil(length);
    const perpX = -dy / length;
    const perpY = dx / length;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = fromX + dx * t;
      const cy = fromY + dy * t;

      for (let w = -width / 2; w <= width / 2; w++) {
        const x = Math.floor(cx + perpX * w);
        const y = Math.floor(cy + perpY * w);
        const key = `${x},${y}`;

        if (!visitedCells.has(key)) {
          visitedCells.add(key);
          positions.push({ x, y });
        }
      }
    }

    return positions;
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

/**
 * TerrainBrush - Terrain painting tools for the 3D editor
 *
 * Handles elevation painting, feature painting, and terrain sculpting.
 */

import type { EditorCell, EditorMapData, EditorConfig, PlatformEdges } from '../config/EditorConfig';
import { distance, clamp } from '@/utils/math';
import {
  validateRampConstraints,
  calculateExtendedRampEndpoint,
  MAX_RAMP_ELEVATION_PER_CELL,
  type RampConstraintResult,
} from '@/data/pathfinding.config';

export interface BrushStroke {
  x: number;
  y: number;
  radius: number;
  intensity: number;
}

export interface CellUpdate {
  x: number;
  y: number;
  cell: Partial<EditorCell> & {
    isPlatform?: boolean;
    edges?: PlatformEdges;
  };
}

/**
 * Result of ramp painting operations.
 * Includes cell updates plus validation info for editor warnings.
 */
export interface RampResult {
  /** Cell updates to apply */
  updates: CellUpdate[];
  /** Ramp constraint validation result */
  validation: RampConstraintResult;
  /** Whether the ramp was auto-extended to meet constraints */
  wasExtended: boolean;
  /** Original endpoint before extension (if extended) */
  originalEndpoint?: { x: number; y: number };
  /** Final endpoint after any extension */
  finalEndpoint: { x: number; y: number };
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
   * Paint a ramp between two points with constraint validation.
   * Auto-extends the ramp if needed to meet walkableClimb constraints.
   * Returns detailed validation info for editor warnings.
   */
  public paintRampWithValidation(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number
  ): RampResult {
    if (!this.mapData) {
      return {
        updates: [],
        validation: {
          isValid: true,
          minRequiredLength: 0,
          actualLength: 0,
          maxElevationPerCell: 0,
        },
        wasExtended: false,
        finalEndpoint: { x: toX, y: toY },
      };
    }

    // Get elevations at endpoints
    const fromCell = this.mapData.terrain[Math.floor(fromY)]?.[Math.floor(fromX)];
    const toCell = this.mapData.terrain[Math.floor(toY)]?.[Math.floor(toX)];
    const fromElev = fromCell?.elevation ?? this.config.terrain.defaultElevation;
    const toElev = toCell?.elevation ?? this.config.terrain.defaultElevation;

    const originalLength = distance(fromX, fromY, toX, toY);
    const elevationDelta = Math.abs(toElev - fromElev);

    // DEBUG: Log constraint check inputs
    console.log(
      `[TerrainBrush] Ramp constraint check: ` +
      `from elev ${fromElev} to elev ${toElev}, delta ${elevationDelta}, ` +
      `original length ${originalLength.toFixed(1)}, ` +
      `max per cell ${MAX_RAMP_ELEVATION_PER_CELL}`
    );

    // Calculate extended endpoint if needed to meet constraints
    const extended = calculateExtendedRampEndpoint(
      fromX,
      fromY,
      toX,
      toY,
      fromElev,
      toElev
    );

    // DEBUG: Log extension result
    console.log(
      `[TerrainBrush] Extension result: wasExtended=${extended.wasExtended}, ` +
      `minRequired=${extended.validation.minRequiredLength}, ` +
      `extended to (${extended.x.toFixed(1)}, ${extended.y.toFixed(1)})`
    );

    // Use extended endpoint for painting
    const actualToX = extended.x;
    const actualToY = extended.y;

    const updates: CellUpdate[] = [];
    const visitedCells = new Set<string>();

    const dx = actualToX - fromX;
    const dy = actualToY - fromY;
    const length = distance(fromX, fromY, actualToX, actualToY);

    if (length === 0) {
      return {
        updates: [],
        validation: extended.validation,
        wasExtended: false,
        finalEndpoint: { x: toX, y: toY },
      };
    }

    const steps = Math.ceil(length);
    const perpX = -dy / length;
    const perpY = dx / length;

    console.log(
      `[TerrainBrush] Painting ramp: length ${length.toFixed(1)} cells, ${steps} steps, width ${width}`
    );

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
              isRamp: true,
            },
          });
        }
      }
    }

    console.log(`[TerrainBrush] Ramp created with ${updates.length} cell updates`);

    return {
      updates,
      validation: extended.validation,
      wasExtended: extended.wasExtended,
      originalEndpoint: extended.wasExtended ? { x: toX, y: toY } : undefined,
      finalEndpoint: { x: actualToX, y: actualToY },
    };
  }

  /**
   * Paint a ramp between two points
   * Creates a walkable gradient between different elevations.
   * Automatically enforces walkableClimb constraints by extending
   * the ramp if needed.
   */
  public paintRamp(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number
  ): CellUpdate[] {
    return this.paintRampWithValidation(fromX, fromY, toX, toY, width).updates;
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
    const length = distance(fromX, fromY, toX, toY);
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
            const newElevation = clamp(Math.round(currentCell.elevation + noise), 0, 255);

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
    const length = distance(fromX, fromY, toX, toY);
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

  // ============================================
  // PLATFORM TERRAIN METHODS
  // ============================================

  /**
   * Standard platform elevation levels (quantized for clean cliffs)
   */
  private static readonly PLATFORM_LEVELS = {
    LOW: 60,
    MID: 140,
    HIGH: 220,
  };

  /**
   * Quantize elevation to nearest platform level
   */
  private quantizeElevation(elevation: number): number {
    if (elevation < 100) return TerrainBrush.PLATFORM_LEVELS.LOW;
    if (elevation < 180) return TerrainBrush.PLATFORM_LEVELS.MID;
    return TerrainBrush.PLATFORM_LEVELS.HIGH;
  }

  /**
   * Paint platform terrain at position (circular brush)
   * Creates geometric platform cells with quantized elevation
   */
  public paintPlatform(
    centerX: number,
    centerY: number,
    radius: number,
    targetElevation: number
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const radiusSq = radius * radius;
    const quantizedElev = this.quantizeElevation(targetElevation);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSq) {
          const x = Math.floor(centerX + dx);
          const y = Math.floor(centerY + dy);

          if (this.isInBounds(x, y)) {
            const cell = this.mapData.terrain[y][x];
            // Don't overwrite ramps
            if (cell.isRamp) continue;

            updates.push({
              x,
              y,
              cell: {
                elevation: quantizedElev,
                isPlatform: true,
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
   * Paint a rectangular platform
   */
  public paintPlatformRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    targetElevation: number
  ): CellUpdate[] {
    if (!this.mapData) return [];

    const updates: CellUpdate[] = [];
    const quantizedElev = this.quantizeElevation(targetElevation);

    const minX = Math.min(Math.floor(x1), Math.floor(x2));
    const maxX = Math.max(Math.floor(x1), Math.floor(x2));
    const minY = Math.min(Math.floor(y1), Math.floor(y2));
    const maxY = Math.max(Math.floor(y1), Math.floor(y2));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!this.isInBounds(x, y)) continue;

        const cell = this.mapData.terrain[y][x];
        if (cell.isRamp) continue;

        updates.push({
          x,
          y,
          cell: {
            elevation: quantizedElev,
            isPlatform: true,
            walkable: true,
          },
        });
      }
    }

    return updates;
  }

  /**
   * Paint a polygon-shaped platform
   * Uses scanline fill algorithm
   */
  public paintPlatformPolygon(
    vertices: Array<{ x: number; y: number }>,
    targetElevation: number
  ): CellUpdate[] {
    if (!this.mapData || vertices.length < 3) return [];

    const updates: CellUpdate[] = [];
    const quantizedElev = this.quantizeElevation(targetElevation);
    const visitedCells = new Set<string>();

    // Find bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }

    // Scanline fill
    for (let py = Math.floor(minY); py <= Math.ceil(maxY); py++) {
      if (!this.isInBounds(0, py)) continue;

      // Find intersections with polygon edges
      const intersections: number[] = [];
      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];

        if ((v1.y <= py && v2.y > py) || (v2.y <= py && v1.y > py)) {
          const t = (py - v1.y) / (v2.y - v1.y);
          intersections.push(v1.x + t * (v2.x - v1.x));
        }
      }

      // Sort and fill between pairs
      intersections.sort((a, b) => a - b);

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.ceil(intersections[i + 1]);

        for (let px = startX; px <= endX; px++) {
          if (!this.isInBounds(px, py)) continue;

          const key = `${px},${py}`;
          if (visitedCells.has(key)) continue;
          visitedCells.add(key);

          const cell = this.mapData.terrain[py][px];
          if (cell.isRamp) continue;

          updates.push({
            x: px,
            y: py,
            cell: {
              elevation: quantizedElev,
              isPlatform: true,
              walkable: true,
            },
          });
        }
      }
    }

    return updates;
  }

  /**
   * Convert existing terrain to platform terrain
   * Quantizes elevation and sets isPlatform flag
   */
  public convertToPlatform(
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
            const cell = this.mapData.terrain[y][x];
            if (cell.isRamp) continue;
            if (cell.isPlatform) continue; // Already a platform

            const quantizedElev = this.quantizeElevation(cell.elevation);

            updates.push({
              x,
              y,
              cell: {
                elevation: quantizedElev,
                isPlatform: true,
              },
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Set edge style for platform cells
   */
  public setPlatformEdgeStyle(
    x: number,
    y: number,
    edge: 'north' | 'south' | 'east' | 'west',
    style: 'cliff' | 'natural' | 'ramp'
  ): CellUpdate[] {
    if (!this.mapData || !this.isInBounds(x, y)) return [];

    const cell = this.mapData.terrain[y][x];
    if (!cell.isPlatform) return [];

    const currentEdges = cell.edges || {};
    const newEdges = { ...currentEdges, [edge]: style };

    return [{
      x,
      y,
      cell: {
        edges: newEdges,
      },
    }];
  }

  /**
   * Get cells along a line for platform edge painting
   */
  public getPlatformLineCells(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number
  ): Array<{ x: number; y: number }> {
    const cells: Array<{ x: number; y: number }> = [];
    const visitedCells = new Set<string>();

    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = distance(fromX, fromY, toX, toY);
    if (length === 0) {
      return [{ x: Math.floor(fromX), y: Math.floor(fromY) }];
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

        if (!visitedCells.has(key)) {
          visitedCells.add(key);
          cells.push({ x, y });
        }
      }
    }

    return cells;
  }

  /**
   * Paint a structured platform ramp with constraint validation.
   * Auto-extends the ramp if needed to meet walkableClimb constraints.
   * Returns detailed validation info for editor warnings.
   */
  public paintPlatformRampWithValidation(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number,
    snapMode: 'none' | 'grid' | 'orthogonal' | '45deg' = '45deg'
  ): RampResult {
    if (!this.mapData) {
      return {
        updates: [],
        validation: {
          isValid: true,
          minRequiredLength: 0,
          actualLength: 0,
          maxElevationPerCell: 0,
        },
        wasExtended: false,
        finalEndpoint: { x: toX, y: toY },
      };
    }

    // Snap endpoint to grid alignment if required
    let snappedToX = toX;
    let snappedToY = toY;

    if (snapMode === 'orthogonal') {
      // Snap to horizontal or vertical (whichever is dominant)
      const dx = Math.abs(toX - fromX);
      const dy = Math.abs(toY - fromY);
      if (dx > dy) {
        snappedToY = fromY;
      } else {
        snappedToX = fromX;
      }
    } else if (snapMode === '45deg') {
      // Snap to nearest 45-degree angle
      const dx = toX - fromX;
      const dy = toY - fromY;
      const angle = Math.atan2(dy, dx);
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const len = distance(fromX, fromY, toX, toY);
      snappedToX = fromX + Math.cos(snappedAngle) * len;
      snappedToY = fromY + Math.sin(snappedAngle) * len;
    } else if (snapMode === 'grid') {
      // Snap to nearest grid cell
      snappedToX = Math.round(toX);
      snappedToY = Math.round(toY);
    }

    const initialLength = distance(fromX, fromY, snappedToX, snappedToY);
    if (initialLength < 1) {
      return {
        updates: [],
        validation: {
          isValid: true,
          minRequiredLength: 0,
          actualLength: 0,
          maxElevationPerCell: 0,
        },
        wasExtended: false,
        finalEndpoint: { x: snappedToX, y: snappedToY },
      };
    }

    // Round positions to ensure pixel-perfect alignment
    const startX = Math.round(fromX);
    const startY = Math.round(fromY);
    let endX = Math.round(snappedToX);
    let endY = Math.round(snappedToY);

    // Calculate direction vectors for finding adjacent platforms
    const tempLength = distance(startX, startY, endX, endY);
    const dirX = tempLength > 0 ? (endX - startX) / tempLength : 0;
    const dirY = tempLength > 0 ? (endY - startY) / tempLength : 0;

    // Get elevations at endpoints (from adjacent cells if needed)
    const fromCell = this.mapData.terrain[Math.floor(fromY)]?.[Math.floor(fromX)];
    const toCell = this.mapData.terrain[Math.floor(snappedToY)]?.[Math.floor(snappedToX)];
    let fromElev = fromCell?.elevation ?? this.config.terrain.defaultElevation;
    let toElev = toCell?.elevation ?? this.config.terrain.defaultElevation;

    // Check adjacent cells to find platform elevation at start/end
    const checkAdjacentElevation = (cx: number, cy: number, searchDir: number): number => {
      for (let dist = 1; dist <= 3; dist++) {
        const checkX = Math.floor(cx + dirX * searchDir * dist);
        const checkY = Math.floor(cy + dirY * searchDir * dist);
        if (this.isInBounds(checkX, checkY)) {
          const cell = this.mapData!.terrain[checkY][checkX];
          if (cell.isPlatform) {
            return cell.elevation;
          }
        }
      }
      return -1;
    };

    // Try to find platform elevations at ends
    const platformElevAtStart = checkAdjacentElevation(startX, startY, -1);
    const platformElevAtEnd = checkAdjacentElevation(endX, endY, 1);

    if (platformElevAtStart >= 0) fromElev = platformElevAtStart;
    if (platformElevAtEnd >= 0) toElev = platformElevAtEnd;

    // Ensure we have different elevations (ramp needs gradient)
    if (fromElev === toElev) {
      // Try to determine direction from terrain context
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const midCell = this.mapData.terrain[Math.floor(midY)]?.[Math.floor(midX)];
      if (midCell) {
        // Use midpoint to determine if going up or down
        if (midCell.elevation < fromElev) {
          toElev = Math.max(0, fromElev - 80);
        } else {
          toElev = Math.min(255, fromElev + 80);
        }
      }
    }

    // Quantize to platform levels for clean transitions
    fromElev = this.quantizeElevation(fromElev);
    toElev = this.quantizeElevation(toElev);

    // Calculate extended endpoint if needed to meet constraints
    const extended = calculateExtendedRampEndpoint(
      startX,
      startY,
      endX,
      endY,
      fromElev,
      toElev
    );

    // Use extended endpoint if needed
    const wasExtended = extended.wasExtended;
    if (wasExtended) {
      endX = Math.round(extended.x);
      endY = Math.round(extended.y);
    }

    const updates: CellUpdate[] = [];
    const visitedCells = new Set<string>();

    const length = distance(startX, startY, endX, endY);
    if (length < 1) {
      return {
        updates: [],
        validation: extended.validation,
        wasExtended: false,
        finalEndpoint: { x: endX, y: endY },
      };
    }

    // Recalculate direction and perpendicular vectors with final positions
    const finalDirX = (endX - startX) / length;
    const finalDirY = (endY - startY) / length;
    const perpX = -finalDirY;
    const perpY = finalDirX;

    // Calculate exact ramp bounds
    const halfWidth = Math.floor(width / 2);
    const steps = Math.ceil(length);

    // Create rectangular ramp with straight edges
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Linear interpolation for position along ramp
      const cx = startX + (endX - startX) * t;
      const cy = startY + (endY - startY) * t;
      // Linear interpolation for elevation
      const elevation = Math.round(fromElev + (toElev - fromElev) * t);

      // Fill width perpendicular to ramp direction
      for (let w = -halfWidth; w <= halfWidth; w++) {
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
              isRamp: true,
              isPlatform: false, // Ramps are not platforms
            },
          });
        }
      }
    }

    return {
      updates,
      validation: extended.validation,
      wasExtended,
      originalEndpoint: wasExtended ? { x: snappedToX, y: snappedToY } : undefined,
      finalEndpoint: { x: endX, y: endY },
    };
  }

  /**
   * Paint a structured platform ramp with perfectly straight edges
   * Creates a rectangular ramp aligned to the direction of travel
   * with uniform width and precise boundaries.
   * Automatically enforces walkableClimb constraints by extending
   * the ramp if needed.
   */
  public paintPlatformRamp(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number,
    snapMode: 'none' | 'grid' | 'orthogonal' | '45deg' = '45deg'
  ): CellUpdate[] {
    return this.paintPlatformRampWithValidation(fromX, fromY, toX, toY, width, snapMode).updates;
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

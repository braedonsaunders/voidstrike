/**
 * AngleConstraint - Snap and angle constraint utilities for platform tools
 *
 * Provides functions to constrain drawing operations to:
 * - Grid alignment (snap to integer coordinates)
 * - Orthogonal angles (0°, 90°, 180°, 270°)
 * - 45-degree angles (adds 45°, 135°, 225°, 315°)
 *
 * Used by platform polygon and line tools for clean geometric shapes.
 */

import type { SnapMode } from '../config/EditorConfig';
import { distance, type Point } from '@/utils/math';

/** Angles for orthogonal snapping (in radians) */
const ORTHOGONAL_ANGLES = [
  0,              // East (right)
  Math.PI / 2,    // South (down)
  Math.PI,        // West (left)
  -Math.PI / 2,   // North (up)
  3 * Math.PI / 2 // Also north (for wraparound)
];

/** Angles for 45-degree snapping (in radians) */
const DIAGONAL_ANGLES = [
  Math.PI / 4,      // SE
  3 * Math.PI / 4,  // SW
  -3 * Math.PI / 4, // NW
  -Math.PI / 4,     // NE
  5 * Math.PI / 4,  // Also SW (wraparound)
  7 * Math.PI / 4,  // Also NE (wraparound)
];

/** Combined orthogonal + diagonal angles */
const ALL_45_ANGLES = [...ORTHOGONAL_ANGLES, ...DIAGONAL_ANGLES];

/**
 * Snap a point to the nearest grid coordinate
 */
export function snapToGrid(point: Point, gridSize: number = 1): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/**
 * Constrain an endpoint based on snap mode
 *
 * @param from - Starting point (anchor)
 * @param to - Target endpoint (will be adjusted)
 * @param mode - Snap mode
 * @param gridSize - Grid cell size for grid snapping
 * @returns Constrained endpoint
 */
export function constrainEndpoint(
  from: Point,
  to: Point,
  mode: SnapMode,
  gridSize: number = 1
): Point {
  switch (mode) {
    case 'none':
      return { ...to };

    case 'grid':
      return snapToGrid(to, gridSize);

    case 'orthogonal':
      return snapToAngle(from, to, ORTHOGONAL_ANGLES);

    case '45deg':
      return snapToAngle(from, to, ALL_45_ANGLES);

    default:
      return { ...to };
  }
}

/**
 * Snap endpoint to the nearest allowed angle from the start point
 */
export function snapToAngle(from: Point, to: Point, allowedAngles: number[]): Point {
  const dist = distance(from.x, from.y, to.x, to.y);

  if (dist < 0.001) {
    return { ...from };
  }

  // Calculate current angle
  const currentAngle = Math.atan2(to.y - from.y, to.x - from.x);

  // Find the nearest allowed angle
  let nearestAngle = allowedAngles[0];
  let minDiff = Math.abs(normalizeAngle(currentAngle - nearestAngle));

  for (const angle of allowedAngles) {
    const diff = Math.abs(normalizeAngle(currentAngle - angle));
    if (diff < minDiff) {
      minDiff = diff;
      nearestAngle = angle;
    }
  }

  // Calculate snapped endpoint at the same distance
  return {
    x: from.x + Math.cos(nearestAngle) * dist,
    y: from.y + Math.sin(nearestAngle) * dist,
  };
}

/**
 * Normalize an angle to the range [-PI, PI]
 */
function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Get visual guides for snap mode (for drawing helper lines)
 * Returns angles in radians that should be highlighted
 */
export function getSnapGuideAngles(mode: SnapMode): number[] {
  switch (mode) {
    case 'orthogonal':
      return [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    case '45deg':
      return [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
    default:
      return [];
  }
}

/**
 * Constrain a polygon's vertices to maintain angle constraints
 * Useful for adjusting vertices after placement
 *
 * @param vertices - Array of polygon vertices
 * @param mode - Snap mode to apply
 * @returns Adjusted vertices with angle constraints
 */
export function constrainPolygon(vertices: Point[], mode: SnapMode): Point[] {
  if (vertices.length < 2 || mode === 'none') {
    return vertices.map(v => ({ ...v }));
  }

  const result: Point[] = [{ ...vertices[0] }];

  for (let i = 1; i < vertices.length; i++) {
    const constrained = constrainEndpoint(result[i - 1], vertices[i], mode);
    result.push(constrained);
  }

  return result;
}

/**
 * Get the constrained preview line from a start point to cursor
 * Returns both the constrained endpoint and whether it's currently snapped
 */
export function getConstrainedPreview(
  from: Point,
  cursor: Point,
  mode: SnapMode,
  gridSize: number = 1
): { endpoint: Point; isSnapped: boolean; snapAngle: number | null } {
  if (mode === 'none') {
    return { endpoint: cursor, isSnapped: false, snapAngle: null };
  }

  const endpoint = constrainEndpoint(from, cursor, mode, gridSize);

  // Check if we actually snapped (endpoint differs from cursor significantly)
  const snapDist = distance(cursor.x, cursor.y, endpoint.x, endpoint.y);
  const isSnapped = snapDist > 0.01;

  // Calculate snap angle if snapped
  let snapAngle: number | null = null;
  if (isSnapped) {
    snapAngle = Math.atan2(endpoint.y - from.y, endpoint.x - from.x);
  }

  return { endpoint, isSnapped, snapAngle };
}

/**
 * Generate a rectangle from two corner points with angle constraints
 * Returns 4 vertices forming a rectangle aligned to the grid/angles
 */
export function constrainRectangle(
  corner1: Point,
  corner2: Point,
  mode: SnapMode,
  rotation: number = 0 // 0 = axis-aligned, PI/4 = 45° rotated
): Point[] {
  // Snap corners to grid if in grid mode
  const c1 = mode === 'grid' ? snapToGrid(corner1) : corner1;
  let c2 = mode === 'grid' ? snapToGrid(corner2) : corner2;

  // For axis-aligned rectangles (rotation = 0)
  if (Math.abs(rotation) < 0.01) {
    return [
      { x: c1.x, y: c1.y },
      { x: c2.x, y: c1.y },
      { x: c2.x, y: c2.y },
      { x: c1.x, y: c2.y },
    ];
  }

  // For rotated rectangles, constrain the diagonal
  const constrained = constrainEndpoint(c1, c2, mode === '45deg' ? '45deg' : 'orthogonal');
  c2 = constrained;

  // Calculate rectangle from rotated diagonal
  const midX = (c1.x + c2.x) / 2;
  const midY = (c1.y + c2.y) / 2;
  const halfDx = (c2.x - c1.x) / 2;
  const halfDy = (c2.y - c1.y) / 2;

  // Perpendicular direction (rotate 90°)
  const perpX = -halfDy;
  const perpY = halfDx;

  return [
    { x: midX - halfDx - perpX, y: midY - halfDy - perpY },
    { x: midX + halfDx - perpX, y: midY + halfDy - perpY },
    { x: midX + halfDx + perpX, y: midY + halfDy + perpY },
    { x: midX - halfDx + perpX, y: midY - halfDy + perpY },
  ];
}

/**
 * Check if an angle is close to a snap angle
 */
export function isNearSnapAngle(angle: number, mode: SnapMode, tolerance: number = 0.1): boolean {
  const angles = getSnapGuideAngles(mode);
  const normalized = normalizeAngle(angle);

  for (const snapAngle of angles) {
    if (Math.abs(normalizeAngle(normalized - snapAngle)) < tolerance) {
      return true;
    }
  }
  return false;
}

/**
 * Get the nearest snap angle to a given angle
 */
export function getNearestSnapAngle(angle: number, mode: SnapMode): number | null {
  const angles = getSnapGuideAngles(mode);
  if (angles.length === 0) return null;

  const normalized = normalizeAngle(angle);
  let nearest = angles[0];
  let minDiff = Math.abs(normalizeAngle(normalized - nearest));

  for (const snapAngle of angles) {
    const diff = Math.abs(normalizeAngle(normalized - snapAngle));
    if (diff < minDiff) {
      minDiff = diff;
      nearest = snapAngle;
    }
  }

  return nearest;
}

export default {
  snapToGrid,
  constrainEndpoint,
  snapToAngle,
  getSnapGuideAngles,
  constrainPolygon,
  getConstrainedPreview,
  constrainRectangle,
  isNearSnapAngle,
  getNearestSnapAngle,
};

/**
 * Border Decorations Utility
 *
 * Generates decorative rock/crystal/tree walls around map borders.
 * Can be used standalone or integrated into the map editor.
 */

import type { EditorMapData, EditorObject } from '../config/EditorConfig';
import { SeededRandom } from '@/utils/math';

// ============================================================================
// TYPES
// ============================================================================

export type BorderDecorationStyle = 'rocks' | 'crystals' | 'trees' | 'mixed' | 'alien' | 'dead_trees';

export interface BorderDecorationSettings {
  style: BorderDecorationStyle;
  density: number; // 0.1 to 1.0
  scaleMin: number; // 0.5 to 2.0
  scaleMax: number; // 1.0 to 4.0
  innerOffset: number; // Distance from edge for inner ring
  outerOffset: number; // Distance from edge for outer ring
  seed?: number; // Random seed for reproducibility
  clearExisting?: boolean; // Remove existing border decorations first
}

export const DEFAULT_BORDER_SETTINGS: BorderDecorationSettings = {
  style: 'rocks',
  density: 0.7,
  scaleMin: 1.5,
  scaleMax: 3.0,
  innerOffset: 15,
  outerOffset: 5,
  clearExisting: true,
};

// ============================================================================
// DECORATION TYPE MAPPING
// ============================================================================

const DECORATION_TYPES: Record<BorderDecorationStyle, string[]> = {
  rocks: ['decoration_rocks_large', 'decoration_rocks_small', 'decoration_rock_single'],
  crystals: ['decoration_crystal_formation'],
  trees: ['decoration_tree_pine_tall', 'decoration_tree_dead'],
  dead_trees: ['decoration_tree_dead'],
  alien: ['decoration_tree_alien', 'decoration_crystal_formation'],
  mixed: ['decoration_rocks_large', 'decoration_rocks_small', 'decoration_crystal_formation', 'decoration_tree_dead'],
};

// IDs for border decorations (to identify and clear them later)
const BORDER_DECORATION_PREFIX = 'border_dec_';

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Generate border decorations for a map
 *
 * @param mapData - The editor map data
 * @param settings - Border decoration settings
 * @returns Updated objects array with border decorations
 */
export function generateBorderDecorations(
  mapData: EditorMapData,
  settings: BorderDecorationSettings = DEFAULT_BORDER_SETTINGS
): EditorObject[] {
  const { width, height } = mapData;
  const {
    style,
    density,
    scaleMin,
    scaleMax,
    innerOffset,
    outerOffset,
    seed = Date.now(),
    clearExisting = true,
  } = settings;

  const random = new SeededRandom(seed);
  const types = DECORATION_TYPES[style];
  const newDecorations: EditorObject[] = [];

  // Get base positions to avoid
  const basePositions = mapData.objects
    .filter(obj => obj.type.includes('base') || obj.type === 'main_base' || obj.type === 'natural')
    .map(obj => ({ x: obj.x, y: obj.y }));

  const isNearBase = (x: number, y: number, minDist: number = 25): boolean => {
    for (const base of basePositions) {
      const dx = x - base.x;
      const dy = y - base.y;
      if (Math.sqrt(dx * dx + dy * dy) < minDist) return true;
    }
    return false;
  };

  const perimeter = 2 * (width + height);
  const count = Math.floor(perimeter * density);

  // Outer ring (massive rocks at edge)
  for (let i = 0; i < count; i++) {
    const t = i / count;
    let x: number, y: number;

    const perimeterPos = t * perimeter;
    if (perimeterPos < width) {
      x = perimeterPos;
      y = outerOffset;
    } else if (perimeterPos < width + height) {
      x = width - outerOffset;
      y = perimeterPos - width;
    } else if (perimeterPos < 2 * width + height) {
      x = width - (perimeterPos - width - height);
      y = height - outerOffset;
    } else {
      x = outerOffset;
      y = height - (perimeterPos - 2 * width - height);
    }

    // Add jitter
    x += (random.next() - 0.5) * 4;
    y += (random.next() - 0.5) * 4;

    // Clamp to map bounds
    x = Math.max(1, Math.min(width - 1, x));
    y = Math.max(1, Math.min(height - 1, y));

    const decType = types[random.nextInt(0, types.length - 1)];
    const scale = scaleMin + random.next() * (scaleMax - scaleMin);

    newDecorations.push({
      id: `${BORDER_DECORATION_PREFIX}outer_${i}`,
      type: decType,
      x,
      y,
      properties: {
        scale,
        rotation: random.next() * Math.PI * 2,
        isBorderDecoration: true,
      },
    });
  }

  // Inner ring (smaller, further from edge)
  const innerCount = Math.floor(count * 0.7);
  for (let i = 0; i < innerCount; i++) {
    const t = i / innerCount;
    let x: number, y: number;

    const innerW = width - 2 * innerOffset;
    const innerH = height - 2 * innerOffset;
    const innerPerimeter = 2 * (innerW + innerH);
    const perimeterPos = t * innerPerimeter;

    if (perimeterPos < innerW) {
      x = innerOffset + perimeterPos;
      y = innerOffset;
    } else if (perimeterPos < innerW + innerH) {
      x = width - innerOffset;
      y = innerOffset + (perimeterPos - innerW);
    } else if (perimeterPos < 2 * innerW + innerH) {
      x = width - innerOffset - (perimeterPos - innerW - innerH);
      y = height - innerOffset;
    } else {
      x = innerOffset;
      y = height - innerOffset - (perimeterPos - 2 * innerW - innerH);
    }

    // Add jitter
    x += (random.next() - 0.5) * 3;
    y += (random.next() - 0.5) * 3;

    // Clamp to map bounds
    x = Math.max(1, Math.min(width - 1, x));
    y = Math.max(1, Math.min(height - 1, y));

    // Skip if near a base
    if (isNearBase(x, y, 20)) continue;

    const decType = types[random.nextInt(0, types.length - 1)];
    const scale = (scaleMin + random.next() * (scaleMax - scaleMin)) * 0.7;

    newDecorations.push({
      id: `${BORDER_DECORATION_PREFIX}inner_${i}`,
      type: decType,
      x,
      y,
      properties: {
        scale,
        rotation: random.next() * Math.PI * 2,
        isBorderDecoration: true,
      },
    });
  }

  // Combine with existing objects
  let existingObjects = mapData.objects;
  if (clearExisting) {
    existingObjects = existingObjects.filter(
      obj => !obj.id.startsWith(BORDER_DECORATION_PREFIX) && !obj.properties?.isBorderDecoration
    );
  }

  return [...existingObjects, ...newDecorations];
}

/**
 * Clear all border decorations from a map
 */
export function clearBorderDecorations(objects: EditorObject[]): EditorObject[] {
  return objects.filter(
    obj => !obj.id.startsWith(BORDER_DECORATION_PREFIX) && !obj.properties?.isBorderDecoration
  );
}

/**
 * Count border decorations in a map
 */
export function countBorderDecorations(objects: EditorObject[]): number {
  return objects.filter(
    obj => obj.id.startsWith(BORDER_DECORATION_PREFIX) || obj.properties?.isBorderDecoration
  ).length;
}

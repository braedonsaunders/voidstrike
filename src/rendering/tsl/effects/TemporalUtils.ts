/**
 * TemporalUtils - Shared utilities for temporal reprojection effects
 *
 * Provides reusable TSL shader building blocks for temporal effects
 * like Temporal AO and Temporal SSR.
 *
 * Core utilities:
 * - Velocity reprojection: Calculate previous frame UV from velocity
 * - Bounds checking: Validate reprojected UV is within screen
 * - Neighborhood clamping: Reduce ghosting by constraining history
 * - Temporal blending: Combine current and history frames
 *
 * ## Type Safety Note
 *
 * TSL shader node parameters use `any` because shader operators work
 * polymorphically. A "texture node" could be any shader graph node that
 * produces color data, and arithmetic operations accept mixed types.
 * This is standard practice for shader DSLs. See `src/types/three-webgpu.d.ts`.
 */

import {
  vec2,
  float,
  mix,
  min,
  max,
  clamp,
} from 'three/tsl';

// ============================================
// UV REPROJECTION
// ============================================

/**
 * Calculate reprojected UV from velocity buffer
 *
 * @param velocityNode Velocity texture node
 * @param fragUV Current fragment UV
 * @returns Previous frame UV
 */
export function calculateReprojectedUV(
  velocityNode: any,
  fragUV: any
): any {
  const velocity = velocityNode.sample(fragUV).xy;
  return fragUV.sub(velocity);
}

/**
 * Check if UV coordinates are within valid bounds [0, 1]
 *
 * @param uvCoord UV coordinates to check
 * @returns Boolean node (true if in bounds)
 */
export function isUVInBounds(uvCoord: any): any {
  return uvCoord.x.greaterThanEqual(0.0)
    .and(uvCoord.x.lessThanEqual(1.0))
    .and(uvCoord.y.greaterThanEqual(0.0))
    .and(uvCoord.y.lessThanEqual(1.0));
}

// ============================================
// NEIGHBORHOOD CLAMPING
// ============================================

/**
 * Sample 3x3 neighborhood and compute min/max bounds
 *
 * Used to constrain history values to prevent ghosting from stale data.
 *
 * @param textureNode Texture to sample
 * @param fragUV Center UV coordinate
 * @param texelSize Texel size (1/resolution)
 * @returns Object with minColor and maxColor nodes
 */
export function sampleNeighborhoodBounds(
  textureNode: any,
  fragUV: any,
  texelSize: any
): { minColor: any; maxColor: any; centerSample: any } {
  // Sample 3x3 neighborhood
  const n0 = textureNode.sample(fragUV.add(vec2(-1, -1).mul(texelSize)));
  const n1 = textureNode.sample(fragUV.add(vec2(0, -1).mul(texelSize)));
  const n2 = textureNode.sample(fragUV.add(vec2(1, -1).mul(texelSize)));
  const n3 = textureNode.sample(fragUV.add(vec2(-1, 0).mul(texelSize)));
  const n4 = textureNode.sample(fragUV); // center
  const n5 = textureNode.sample(fragUV.add(vec2(1, 0).mul(texelSize)));
  const n6 = textureNode.sample(fragUV.add(vec2(-1, 1).mul(texelSize)));
  const n7 = textureNode.sample(fragUV.add(vec2(0, 1).mul(texelSize)));
  const n8 = textureNode.sample(fragUV.add(vec2(1, 1).mul(texelSize)));

  // Compute min/max across neighborhood
  const minColor = min(min(min(min(n0, n1), min(n2, n3)), min(min(n4, n5), min(n6, n7))), n8);
  const maxColor = max(max(max(max(n0, n1), max(n2, n3)), max(max(n4, n5), max(n6, n7))), n8);

  return { minColor, maxColor, centerSample: n4 };
}

/**
 * Apply neighborhood clamping to history value
 *
 * @param historyValue Value from history buffer
 * @param minColor Minimum from neighborhood
 * @param maxColor Maximum from neighborhood
 * @returns Clamped history value
 */
export function applyNeighborhoodClamp(
  historyValue: any,
  minColor: any,
  maxColor: any
): any {
  return clamp(historyValue, minColor, maxColor);
}

// ============================================
// TEMPORAL BLENDING CORE
// ============================================

/**
 * Core temporal blend operation
 *
 * Blends current frame value with history, respecting bounds validity.
 *
 * @param currentValue Current frame value
 * @param historyValue History buffer value (may be clamped)
 * @param blendFactor How much history to use (0.0-1.0)
 * @param inBounds Whether the reprojected UV is valid
 * @returns Blended result
 */
export function temporalBlend(
  currentValue: any,
  historyValue: any,
  blendFactor: any,
  inBounds: any
): any {
  const effectiveBlend = inBounds.select(blendFactor, float(0.0));
  return mix(currentValue, historyValue, effectiveBlend);
}

// ============================================
// DEFAULT BLEND FACTORS
// ============================================

/** Default blend factor for temporal AO (high history weight) */
export const DEFAULT_AO_BLEND_FACTOR = 0.9;

/** Default blend factor for temporal SSR (lower due to parallax) */
export const DEFAULT_SSR_BLEND_FACTOR = 0.85;

/** Default blend factor for generic temporal effects */
export const DEFAULT_TEMPORAL_BLEND_FACTOR = 0.9;

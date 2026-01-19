/**
 * TemporalUtils - Shared utilities for temporal reprojection effects
 *
 * This module provides reusable TSL shader building blocks for temporal
 * effects like TAO (Temporal AO) and TSSR (Temporal SSR).
 *
 * Core utilities:
 * - Velocity reprojection: Calculate previous frame UV from velocity
 * - Bounds checking: Validate reprojected UV is within screen
 * - Neighborhood clamping: Reduce ghosting by constraining history
 * - Temporal blending: Combine current and history frames
 */

import * as THREE from 'three';
import {
  Fn,
  vec2,
  vec4,
  float,
  texture,
  uv,
  uniform,
  mix,
  min,
  max,
  clamp,
} from 'three/tsl';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface TemporalBlendConfig {
  /** History blend factor (0.0-1.0), higher = more history. Default: 0.9 */
  blendFactor: number;
}

export interface NeighborhoodClampConfig {
  /** Resolution uniform for texel size calculation */
  resolutionUniform: ReturnType<typeof uniform>;
}

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
// HIGH-LEVEL TEMPORAL BLEND NODES
// ============================================

/**
 * Create a simple temporal blend node (no neighborhood clamping)
 *
 * Suitable for effects like AO where ghosting is less visible.
 *
 * @param currentTexture Current frame texture
 * @param historyTexture History buffer texture
 * @param velocityNode Velocity texture node
 * @param blendUniform Blend factor uniform
 * @returns TSL node for temporal blending
 */
export function createSimpleTemporalBlendNode(
  currentTexture: THREE.Texture,
  historyTexture: THREE.Texture,
  velocityNode: any,
  blendUniform: ReturnType<typeof uniform>
): any {
  const currentNode = texture(currentTexture);
  const historyNode = texture(historyTexture);

  return Fn(() => {
    const fragUV = uv();
    const prevUV = calculateReprojectedUV(velocityNode, fragUV);

    const current = currentNode.sample(fragUV);
    const history = historyNode.sample(prevUV);
    const inBounds = isUVInBounds(prevUV);

    return temporalBlend(current, history, blendUniform, inBounds);
  })();
}

/**
 * Create a temporal blend node with neighborhood clamping
 *
 * Suitable for effects like SSR where ghosting is more noticeable.
 *
 * @param currentTexture Current frame texture
 * @param historyTexture History buffer texture
 * @param velocityNode Velocity texture node
 * @param resolutionUniform Resolution for texel size calculation
 * @param blendUniform Blend factor uniform
 * @returns TSL node for temporal blending with clamping
 */
export function createClampedTemporalBlendNode(
  currentTexture: THREE.Texture,
  historyTexture: THREE.Texture,
  velocityNode: any,
  resolutionUniform: ReturnType<typeof uniform>,
  blendUniform: ReturnType<typeof uniform>
): any {
  const currentNode = texture(currentTexture);
  const historyNode = texture(historyTexture);

  return Fn(() => {
    const fragUV = uv();
    const prevUV = calculateReprojectedUV(velocityNode, fragUV);
    const texelSize = vec2(1.0).div(resolutionUniform);

    // Sample current with neighborhood bounds
    const { minColor, maxColor, centerSample } = sampleNeighborhoodBounds(
      currentNode,
      fragUV,
      texelSize
    );

    // Sample and clamp history
    const history = historyNode.sample(prevUV);
    const clampedHistory = applyNeighborhoodClamp(history, minColor, maxColor);

    const inBounds = isUVInBounds(prevUV);

    return temporalBlend(centerSample, clampedHistory, blendUniform, inBounds);
  })();
}

/**
 * Create a temporal blend node for single-channel data (e.g., AO)
 *
 * @param currentTexture Current frame texture (single channel)
 * @param historyTexture History buffer texture
 * @param velocityNode Velocity texture node
 * @param blendUniform Blend factor uniform
 * @returns TSL node outputting single channel
 */
export function createSingleChannelTemporalBlendNode(
  currentTexture: THREE.Texture,
  historyTexture: THREE.Texture,
  velocityNode: any,
  blendUniform: ReturnType<typeof uniform>
): any {
  const currentNode = texture(currentTexture);
  const historyNode = texture(historyTexture);

  return Fn(() => {
    const fragUV = uv();
    const prevUV = calculateReprojectedUV(velocityNode, fragUV);

    const current = currentNode.sample(fragUV).r;
    const history = historyNode.sample(prevUV).r;
    const inBounds = isUVInBounds(prevUV);

    return temporalBlend(current, history, blendUniform, inBounds);
  })();
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

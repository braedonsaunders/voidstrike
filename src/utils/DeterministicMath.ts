/**
 * Deterministic math utilities for lockstep simulation.
 *
 * The simulation uses quantization plus integer square roots instead of a
 * mixed fixed-point/float pipeline. This keeps the runtime math path explicit
 * and avoids the old Q16.16 helpers that were no longer used by gameplay code.
 */

/**
 * Quantization precision levels
 */
export const QUANT_POSITION = 1000; // 0.001 unit precision for positions
export const QUANT_DAMAGE = 100; // 0.01 precision for damage
export const QUANT_COOLDOWN = 1000; // 0.001 second precision for cooldowns

/**
 * Quantize a floating-point value to a deterministic grid
 * Returns an integer that can be safely compared across platforms
 */
export function quantize(value: number, precision: number): number {
  return Math.round(value * precision) | 0;
}

/**
 * Dequantize an integer back to floating-point
 */
export function dequantize(quantized: number, precision: number): number {
  return quantized / precision;
}

/**
 * Quantize damage value for deterministic damage calculations
 */
function quantizeDamage(damage: number): number {
  return quantize(damage, QUANT_DAMAGE);
}

/**
 * Dequantize damage back to float
 */
function dequantizeDamage(quantized: number): number {
  return dequantize(quantized, QUANT_DAMAGE);
}

/**
 * Snap a floating-point position to the quantization grid
 * Use this when setting positions to ensure they're deterministic
 */
export function snapPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(x * QUANT_POSITION) / QUANT_POSITION,
    y: Math.round(y * QUANT_POSITION) / QUANT_POSITION,
  };
}

/**
 * Snap a single value to the position grid
 */
export function snapValue(value: number, precision: number = QUANT_POSITION): number {
  return Math.round(value * precision) / precision;
}

/**
 * Integer square root using binary search
 * Returns floor(sqrt(n)) for non-negative integers
 * Fully deterministic across platforms
 */
export function integerSqrt(n: number): number {
  if (n < 0) return 0;
  if (n < 2) return n;

  // Use BigInt for large numbers to avoid precision issues
  if (n > 0x7fffffff) {
    const nBig = BigInt(Math.floor(n));
    let lo = BigInt(1);
    let hi = nBig;

    while (lo <= hi) {
      const mid = (lo + hi) >> BigInt(1);
      const sq = mid * mid;
      if (sq === nBig) return Number(mid);
      if (sq < nBig) {
        lo = mid + BigInt(1);
      } else {
        hi = mid - BigInt(1);
      }
    }
    return Number(hi);
  }

  // Binary search for smaller numbers
  let lo = 1;
  let hi = Math.min(n, 46340); // sqrt(2^31-1) ≈ 46340

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const sq = mid * mid;
    if (sq === n) return mid;
    if (sq < n) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return hi;
}

/**
 * Deterministic distance calculation using quantized positions
 * Uses integer sqrt instead of Math.sqrt for cross-platform determinism.
 *
 * This function and related deterministic math utilities are integrated into
 * all multiplayer-critical game systems (CombatSystem, ProjectileSystem,
 * PathfindingSystem, MovementOrchestrator, FlockingBehavior, etc.) to prevent
 * desync caused by floating-point differences across CPUs/browsers.
 */
export function deterministicDistance(x1: number, y1: number, x2: number, y2: number): number {
  // Quantize inputs
  const qx1 = quantize(x1, QUANT_POSITION);
  const qy1 = quantize(y1, QUANT_POSITION);
  const qx2 = quantize(x2, QUANT_POSITION);
  const qy2 = quantize(y2, QUANT_POSITION);

  // Calculate squared distance in quantized space
  const dx = qx2 - qx1;
  const dy = qy2 - qy1;
  const distSq = dx * dx + dy * dy;

  // Use deterministic integer square root, then convert back
  const dist = integerSqrt(distSq);
  return dist / QUANT_POSITION;
}

/**
 * Deterministic squared distance (avoids sqrt entirely)
 */
export function deterministicDistanceSquared(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const qx1 = quantize(x1, QUANT_POSITION);
  const qy1 = quantize(y1, QUANT_POSITION);
  const qx2 = quantize(x2, QUANT_POSITION);
  const qy2 = quantize(y2, QUANT_POSITION);

  const dx = qx2 - qx1;
  const dy = qy2 - qy1;

  // Return in original units squared
  return (dx * dx + dy * dy) / (QUANT_POSITION * QUANT_POSITION);
}

/**
 * Deterministic damage calculation
 */
export function deterministicDamage(baseDamage: number, multiplier: number, armor: number): number {
  // Quantize all inputs
  const qDamage = quantizeDamage(baseDamage);
  const qMultiplier = quantize(multiplier, QUANT_DAMAGE);
  const qArmor = quantizeDamage(armor);

  // Calculate in quantized space
  // damage = baseDamage * multiplier - armor
  const scaledDamage = Math.floor((qDamage * qMultiplier) / QUANT_DAMAGE);
  const finalDamage = Math.max(QUANT_DAMAGE, scaledDamage - qArmor); // Min 1 damage

  return dequantizeDamage(finalDamage);
}

/**
 * Deterministic normalization of a 2D vector
 * Uses integerSqrt for cross-platform determinism
 */
export function deterministicNormalize(x: number, y: number): { x: number; y: number } {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);

  const magSq = qx * qx + qy * qy;
  if (magSq === 0) return { x: 0, y: 0 };

  const mag = integerSqrt(magSq);
  if (mag === 0) return { x: 0, y: 0 };

  return {
    x: qx / mag,
    y: qy / mag,
  };
}

// =============================================================================
// Deterministic Magnitude Functions for Multiplayer
// =============================================================================

/**
 * Deterministic 2D vector magnitude
 * Uses quantization + integer sqrt for cross-platform determinism.
 *
 * @param x - X component of vector
 * @param y - Y component of vector
 * @returns Deterministic magnitude value
 */
export function deterministicMagnitude(x: number, y: number): number {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);

  const magSq = qx * qx + qy * qy;
  if (magSq === 0) return 0;

  const mag = integerSqrt(magSq);
  return mag / QUANT_POSITION;
}

/**
 * Deterministic 2D vector magnitude squared
 * Avoids sqrt entirely - use when comparing against thresholds.
 *
 * @param x - X component of vector
 * @param y - Y component of vector
 * @returns Deterministic magnitude squared value
 */
export function deterministicMagnitudeSquared(x: number, y: number): number {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);

  return (qx * qx + qy * qy) / (QUANT_POSITION * QUANT_POSITION);
}

/**
 * Deterministic 3D vector magnitude
 * Uses quantization + integer sqrt for cross-platform determinism.
 *
 * @param x - X component of vector
 * @param y - Y component of vector
 * @param z - Z component of vector
 * @returns Deterministic magnitude value
 */
export function deterministicMagnitude3D(x: number, y: number, z: number): number {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);
  const qz = quantize(z, QUANT_POSITION);

  const magSq = qx * qx + qy * qy + qz * qz;
  if (magSq === 0) return 0;

  const mag = integerSqrt(magSq);
  return mag / QUANT_POSITION;
}

/**
 * Deterministic 3D vector magnitude squared
 * Avoids sqrt entirely - use when comparing against thresholds.
 *
 * @param x - X component of vector
 * @param y - Y component of vector
 * @param z - Z component of vector
 * @returns Deterministic magnitude squared value
 */
export function deterministicMagnitude3DSquared(x: number, y: number, z: number): number {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);
  const qz = quantize(z, QUANT_POSITION);

  return (qx * qx + qy * qy + qz * qz) / (QUANT_POSITION * QUANT_POSITION);
}

/**
 * Deterministic square root for general use
 * Uses quantization + integer sqrt for cross-platform determinism.
 * Suitable for physics calculations like sqrt(2 * decel * dist).
 *
 * @param value - Non-negative value to take sqrt of
 * @returns Deterministic square root
 */
export function deterministicSqrt(value: number): number {
  if (value <= 0) return 0;

  // Quantize to fixed precision
  const qValue = quantize(value, QUANT_POSITION);
  if (qValue <= 0) return 0;

  // Scale up for precision, compute sqrt, scale back down
  // We use a higher precision scale for the input to preserve accuracy
  const scaledValue = qValue * QUANT_POSITION;
  const sqrtScaled = integerSqrt(scaledValue);

  return sqrtScaled / QUANT_POSITION;
}

/**
 * Deterministic 2D normalization with separate output
 * Returns both the normalized vector and the original magnitude.
 * More efficient when you need both values.
 *
 * @param x - X component of vector
 * @param y - Y component of vector
 * @returns Object with normalized components (nx, ny) and magnitude
 */
export function deterministicNormalizeWithMagnitude(
  x: number,
  y: number
): { nx: number; ny: number; magnitude: number } {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);

  const magSq = qx * qx + qy * qy;
  if (magSq === 0) return { nx: 0, ny: 0, magnitude: 0 };

  const magInt = integerSqrt(magSq);
  if (magInt === 0) return { nx: 0, ny: 0, magnitude: 0 };

  return {
    nx: qx / magInt,
    ny: qy / magInt,
    magnitude: magInt / QUANT_POSITION,
  };
}

/**
 * Deterministic 3D normalization with separate output
 * Returns both the normalized vector and the original magnitude.
 *
 * @param x - X component of vector
 * @param y - Y component of vector
 * @param z - Z component of vector
 * @returns Object with normalized components (nx, ny, nz) and magnitude
 */
export function deterministicNormalize3DWithMagnitude(
  x: number,
  y: number,
  z: number
): { nx: number; ny: number; nz: number; magnitude: number } {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);
  const qz = quantize(z, QUANT_POSITION);

  const magSq = qx * qx + qy * qy + qz * qz;
  if (magSq === 0) return { nx: 0, ny: 0, nz: 0, magnitude: 0 };

  const magInt = integerSqrt(magSq);
  if (magInt === 0) return { nx: 0, ny: 0, nz: 0, magnitude: 0 };

  return {
    nx: qx / magInt,
    ny: qy / magInt,
    nz: qz / magInt,
    magnitude: magInt / QUANT_POSITION,
  };
}

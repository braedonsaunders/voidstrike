/**
 * Fixed-Point Math Utilities for Deterministic Game Simulation
 *
 * This module provides fixed-point arithmetic to ensure deterministic
 * calculations across different platforms and browsers. Floating-point
 * operations can produce subtly different results on different CPUs,
 * which causes multiplayer desync.
 *
 * We use Q16.16 format (16 bits integer, 16 bits fractional)
 * Range: -32768.0 to 32767.99998 with precision of ~0.00001
 */

// Fixed-point configuration
export const FP_SHIFT = 16;
export const FP_SCALE = 1 << FP_SHIFT; // 65536
export const FP_HALF = FP_SCALE >> 1; // 32768 (for rounding)
export const FP_MASK = FP_SCALE - 1; // 65535 (fractional mask)

// Precomputed constants
export const FP_ONE = FP_SCALE;

// Maximum safe value to prevent overflow in multiplication
export const FP_MAX_SAFE = 0x7fff0000; // ~32767
export const FP_MIN_SAFE = -0x7fff0000;

/**
 * Convert a floating-point number to fixed-point
 */
export function fpFromFloat(value: number): number {
  return Math.round(value * FP_SCALE) | 0;
}

/**
 * Convert a fixed-point number to floating-point
 * Use sparingly - only for rendering/display purposes
 */
export function fpToFloat(fp: number): number {
  return fp / FP_SCALE;
}

/**
 * Convert an integer to fixed-point
 */
export function fpFromInt(value: number): number {
  return (value << FP_SHIFT) | 0;
}

/**
 * Convert a fixed-point number to integer (truncates fractional part)
 */
export function fpToInt(fp: number): number {
  return (fp >> FP_SHIFT) | 0;
}

/**
 * Add two fixed-point numbers
 */
export function fpAdd(a: number, b: number): number {
  return (a + b) | 0;
}

/**
 * Subtract two fixed-point numbers
 */
export function fpSub(a: number, b: number): number {
  return (a - b) | 0;
}

/**
 * Multiply two fixed-point numbers
 * Uses BigInt for intermediate calculation to prevent overflow
 * FIX: Previous implementation had overflow bug in mid = lh + hl
 */
export function fpMul(a: number, b: number): number {
  // Use BigInt for full 64-bit precision to avoid overflow
  const aBig = BigInt(a);
  const bBig = BigInt(b);

  // Full 64-bit multiplication, then shift right by FP_SHIFT
  const result = (aBig * bBig) >> BigInt(FP_SHIFT);

  // Convert back to number, truncating to 32-bit integer
  return Number(result) | 0;
}

/**
 * Divide two fixed-point numbers
 */
export function fpDiv(a: number, b: number): number {
  if (b === 0) return a >= 0 ? FP_MAX_SAFE : FP_MIN_SAFE;

  // Shift numerator left before division for precision
  // Need to handle potential overflow for large numerators
  const sign = (a ^ b) < 0 ? -1 : 1;
  const absA = Math.abs(a);
  const absB = Math.abs(b);

  // Use JavaScript's safe integer range for the intermediate calculation
  const result = Math.floor((absA * FP_SCALE) / absB);

  return (sign * result) | 0;
}

/**
 * Fixed-point square root using Newton-Raphson iteration
 * Input and output are in fixed-point format
 */
export function fpSqrt(fp: number): number {
  if (fp <= 0) return 0;

  // Initial guess using floating point (acceptable for initialization)
  let x = fpFromFloat(Math.sqrt(fpToFloat(fp)));

  // Newton-Raphson iterations for refinement
  // x_new = (x + fp/x) / 2
  for (let i = 0; i < 4; i++) {
    if (x === 0) break;
    const div = fpDiv(fp, x);
    x = (x + div) >> 1;
  }

  return x;
}

// =============================================================================
// Quantization Layer for Snapping Floating-Point to Deterministic Grid
// =============================================================================

/**
 * Quantization precision levels
 */
export const QUANT_POSITION = 1000; // 0.001 unit precision for positions
export const QUANT_DAMAGE = 100; // 0.01 precision for damage
export const QUANT_COOLDOWN = 1000; // 0.001 second precision for cooldowns
export const QUANT_VELOCITY = 1000; // 0.001 precision for velocity

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

// =============================================================================
// Deterministic Math Wrappers
// =============================================================================

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

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
export const FP_HALF = FP_SCALE >> 1;   // 32768 (for rounding)
export const FP_MASK = FP_SCALE - 1;    // 65535 (fractional mask)

// Precomputed constants
export const FP_ZERO = 0;
export const FP_ONE = FP_SCALE;
export const FP_TWO = FP_SCALE << 1;
export const FP_HALF_VAL = FP_HALF;
export const FP_PI = Math.round(Math.PI * FP_SCALE);
export const FP_TWO_PI = Math.round(2 * Math.PI * FP_SCALE);
export const FP_HALF_PI = Math.round(Math.PI * 0.5 * FP_SCALE);

// Maximum safe value to prevent overflow in multiplication
export const FP_MAX_SAFE = 0x7FFF0000; // ~32767
export const FP_MIN_SAFE = -0x7FFF0000;

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
 * Round a fixed-point number to nearest integer (in fixed-point)
 */
export function fpRound(fp: number): number {
  return ((fp + FP_HALF) >> FP_SHIFT) << FP_SHIFT;
}

/**
 * Floor a fixed-point number (in fixed-point)
 */
export function fpFloor(fp: number): number {
  return (fp >> FP_SHIFT) << FP_SHIFT;
}

/**
 * Ceiling of a fixed-point number (in fixed-point)
 */
export function fpCeil(fp: number): number {
  return ((fp + FP_MASK) >> FP_SHIFT) << FP_SHIFT;
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

/**
 * Fixed-point distance calculation
 * Returns distance in fixed-point format
 */
export function fpDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = fpSub(x2, x1);
  const dy = fpSub(y2, y1);
  const dxSq = fpMul(dx, dx);
  const dySq = fpMul(dy, dy);
  return fpSqrt(fpAdd(dxSq, dySq));
}

/**
 * Fixed-point distance squared (avoids sqrt for comparisons)
 */
export function fpDistanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = fpSub(x2, x1);
  const dy = fpSub(y2, y1);
  return fpAdd(fpMul(dx, dx), fpMul(dy, dy));
}

/**
 * Fixed-point magnitude/length of a 2D vector
 */
export function fpMagnitude(x: number, y: number): number {
  return fpSqrt(fpAdd(fpMul(x, x), fpMul(y, y)));
}

/**
 * Normalize a 2D vector in fixed-point
 * Returns {x, y} in fixed-point format
 */
export function fpNormalize(x: number, y: number): { x: number; y: number } {
  const mag = fpMagnitude(x, y);
  if (mag === 0) return { x: 0, y: 0 };
  return {
    x: fpDiv(x, mag),
    y: fpDiv(y, mag),
  };
}

/**
 * Clamp a fixed-point value between min and max
 */
export function fpClamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Linear interpolation in fixed-point
 * t should be in fixed-point format (0 to FP_ONE)
 */
export function fpLerp(a: number, b: number, t: number): number {
  return fpAdd(a, fpMul(fpSub(b, a), t));
}

/**
 * Fixed-point absolute value
 */
export function fpAbs(fp: number): number {
  return fp < 0 ? -fp : fp;
}

/**
 * Fixed-point minimum
 */
export function fpMin(a: number, b: number): number {
  return a < b ? a : b;
}

/**
 * Fixed-point maximum
 */
export function fpMax(a: number, b: number): number {
  return a > b ? a : b;
}

// =============================================================================
// Lookup Tables for Trigonometric Functions
// =============================================================================

// Sine lookup table with 1024 entries (covers 0 to 2*PI)
const SINE_TABLE_SIZE = 1024;
const SINE_TABLE: number[] = new Array(SINE_TABLE_SIZE);

// Initialize sine table
for (let i = 0; i < SINE_TABLE_SIZE; i++) {
  const angle = (i / SINE_TABLE_SIZE) * Math.PI * 2;
  SINE_TABLE[i] = Math.round(Math.sin(angle) * FP_SCALE);
}

/**
 * Fixed-point sine using lookup table
 * Input angle in fixed-point radians
 */
export function fpSin(angle: number): number {
  // Normalize angle to 0..2*PI range
  const normalized = ((angle % FP_TWO_PI) + FP_TWO_PI) % FP_TWO_PI;

  // Convert to table index
  const index = Math.floor((normalized * SINE_TABLE_SIZE) / FP_TWO_PI) % SINE_TABLE_SIZE;

  return SINE_TABLE[index];
}

/**
 * Fixed-point cosine using lookup table
 * Input angle in fixed-point radians
 */
export function fpCos(angle: number): number {
  return fpSin(fpAdd(angle, FP_HALF_PI));
}

/**
 * Fixed-point atan2 approximation
 * Returns angle in fixed-point radians
 */
export function fpAtan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;

  // Use floating point atan2 and convert (acceptable for direction calculations)
  const angle = Math.atan2(fpToFloat(y), fpToFloat(x));
  return fpFromFloat(angle);
}

// =============================================================================
// Quantization Layer for Snapping Floating-Point to Deterministic Grid
// =============================================================================

/**
 * Quantization precision levels
 */
export const QUANT_POSITION = 1000;      // 0.001 unit precision for positions
export const QUANT_DAMAGE = 100;          // 0.01 precision for damage
export const QUANT_COOLDOWN = 1000;       // 0.001 second precision for cooldowns
export const QUANT_VELOCITY = 1000;       // 0.001 precision for velocity

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
 * Quantized position for deterministic position comparisons
 */
export interface QuantizedPosition {
  qx: number;
  qy: number;
}

/**
 * Quantize a 2D position
 */
export function quantizePosition(x: number, y: number): QuantizedPosition {
  return {
    qx: quantize(x, QUANT_POSITION),
    qy: quantize(y, QUANT_POSITION),
  };
}

/**
 * Dequantize a 2D position back to floats
 */
export function dequantizePosition(pos: QuantizedPosition): { x: number; y: number } {
  return {
    x: dequantize(pos.qx, QUANT_POSITION),
    y: dequantize(pos.qy, QUANT_POSITION),
  };
}

/**
 * Quantize damage value for deterministic damage calculations
 */
export function quantizeDamage(damage: number): number {
  return quantize(damage, QUANT_DAMAGE);
}

/**
 * Dequantize damage back to float
 */
export function dequantizeDamage(quantized: number): number {
  return dequantize(quantized, QUANT_DAMAGE);
}

/**
 * Quantize cooldown/time value
 */
export function quantizeCooldown(cooldown: number): number {
  return quantize(cooldown, QUANT_COOLDOWN);
}

/**
 * Dequantize cooldown back to float
 */
export function dequantizeCooldown(quantized: number): number {
  return dequantize(quantized, QUANT_COOLDOWN);
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
  if (n > 0x7FFFFFFF) {
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
 * FIX: Uses integer sqrt instead of Math.sqrt for cross-platform determinism
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
export function deterministicDistanceSquared(x1: number, y1: number, x2: number, y2: number): number {
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
export function deterministicDamage(
  baseDamage: number,
  multiplier: number,
  armor: number
): number {
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
 */
export function deterministicNormalize(x: number, y: number): { x: number; y: number } {
  const qx = quantize(x, QUANT_POSITION);
  const qy = quantize(y, QUANT_POSITION);

  const magSq = qx * qx + qy * qy;
  if (magSq === 0) return { x: 0, y: 0 };

  const mag = Math.sqrt(magSq);
  return {
    x: qx / mag,
    y: qy / mag,
  };
}

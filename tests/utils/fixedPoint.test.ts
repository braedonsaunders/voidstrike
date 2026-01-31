import { describe, it, expect } from 'vitest';
import {
  FP_MAX_SAFE,
  FP_MIN_SAFE,
  FP_SCALE,
  deterministicDamage,
  deterministicDistance,
  deterministicDistanceSquared,
  deterministicNormalize,
  fpAdd,
  fpSub,
  fpDiv,
  fpFromFloat,
  fpFromInt,
  fpToInt,
  fpMul,
  fpSqrt,
  fpToFloat,
  integerSqrt,
  quantize,
  dequantize,
  snapPosition,
  snapValue,
  QUANT_POSITION,
} from '@/utils/FixedPoint';

describe('FixedPoint utilities', () => {
  it('round-trips floats through fixed-point conversion', () => {
    const value = 1.2345;
    const fixed = fpFromFloat(value);
    const roundTrip = fpToFloat(fixed);

    expect(Math.abs(roundTrip - value)).toBeLessThan(0.0002);
  });

  it('multiplies fixed-point values deterministically', () => {
    const a = fpFromFloat(1.5);
    const b = fpFromFloat(-2.25);
    const result = fpMul(a, b);

    expect(Math.abs(fpToFloat(result) + 3.375)).toBeLessThan(0.0002);
  });

  it('divides with zero denominator safely', () => {
    expect(fpDiv(10, 0)).toBe(FP_MAX_SAFE);
    expect(fpDiv(-10, 0)).toBe(FP_MIN_SAFE);
  });

  it('computes integer square roots deterministically', () => {
    expect(integerSqrt(0)).toBe(0);
    expect(integerSqrt(1)).toBe(1);
    expect(integerSqrt(15)).toBe(3);
    expect(integerSqrt(16)).toBe(4);
    expect(integerSqrt(0x80000000)).toBe(46340);
  });

  it('computes deterministic distance on quantized coordinates', () => {
    expect(Math.abs(deterministicDistance(0, 0, 3, 4) - 5)).toBeLessThan(0.0001);
  });

  it('enforces minimum deterministic damage', () => {
    const damage = deterministicDamage(5, 1, 10);
    expect(damage).toBe(1);
  });

  it('quantizes and dequantizes values consistently', () => {
    const quantized = quantize(3.14159, 1000);
    expect(Math.abs(dequantize(quantized, 1000) - 3.142)).toBeLessThan(0.001);
  });
});

describe('FixedPoint edge cases', () => {
  describe('overflow handling', () => {
    it('handles multiplication of large positive values without overflow', () => {
      // Two large values that would overflow with naive multiplication
      const a = fpFromFloat(100);
      const b = fpFromFloat(100);
      const result = fpMul(a, b);

      expect(Math.abs(fpToFloat(result) - 10000)).toBeLessThan(0.01);
    });

    it('handles multiplication of values near FP_MAX_SAFE', () => {
      // Values close to the maximum safe range
      const a = fpFromFloat(180);
      const b = fpFromFloat(180);
      const result = fpMul(a, b);

      expect(Math.abs(fpToFloat(result) - 32400)).toBeLessThan(0.1);
    });

    it('handles multiplication of moderately large values', () => {
      const a = fpFromFloat(50);
      const b = fpFromFloat(50);
      const result = fpMul(a, b);

      expect(Math.abs(fpToFloat(result) - 2500)).toBeLessThan(0.01);
    });

    it('handles chained multiplications without cumulative overflow', () => {
      let result = fpFromFloat(2);

      // Multiply by 2 ten times: 2^10 = 1024
      for (let i = 0; i < 10; i++) {
        result = fpMul(result, fpFromFloat(2));
      }

      expect(Math.abs(fpToFloat(result) - 2048)).toBeLessThan(0.1);
    });

    it('handles addition near max values', () => {
      const a = fpFromFloat(16000);
      const b = fpFromFloat(16000);
      const result = fpAdd(a, b);

      expect(Math.abs(fpToFloat(result) - 32000)).toBeLessThan(0.1);
    });
  });

  describe('underflow handling', () => {
    it('handles very small positive values', () => {
      const tiny = fpFromFloat(0.00001);
      expect(fpToFloat(tiny)).toBeGreaterThanOrEqual(0);
      expect(fpToFloat(tiny)).toBeLessThan(0.001);
    });

    it('handles multiplication resulting in very small values', () => {
      const a = fpFromFloat(0.01);
      const b = fpFromFloat(0.01);
      const result = fpMul(a, b);

      expect(Math.abs(fpToFloat(result) - 0.0001)).toBeLessThan(0.001);
    });

    it('handles subtraction resulting in very small values', () => {
      const a = fpFromFloat(1.0001);
      const b = fpFromFloat(1.0);
      const result = fpSub(a, b);

      expect(Math.abs(fpToFloat(result) - 0.0001)).toBeLessThan(0.001);
    });

    it('handles values at precision boundary', () => {
      // The precision of Q16.16 is about 1/65536 ≈ 0.000015
      const minPrecision = 1 / FP_SCALE;
      const value = fpFromFloat(minPrecision);

      expect(fpToFloat(value)).toBeLessThanOrEqual(minPrecision * 2);
    });
  });

  describe('precision boundaries', () => {
    it('preserves precision for common game values', () => {
      const testValues = [0.5, 1.5, 2.5, 10.25, 100.125];

      for (const value of testValues) {
        const fixed = fpFromFloat(value);
        const roundTrip = fpToFloat(fixed);
        expect(Math.abs(roundTrip - value)).toBeLessThan(0.0001);
      }
    });

    it('handles fractional precision correctly', () => {
      // Test values with many decimal places
      const value = 3.141592653;
      const fixed = fpFromFloat(value);
      const roundTrip = fpToFloat(fixed);

      // Q16.16 precision is ~0.00001
      expect(Math.abs(roundTrip - value)).toBeLessThan(0.0001);
    });

    it('handles negative values correctly', () => {
      const testValues = [-0.5, -1.5, -10.25, -100.5];

      for (const value of testValues) {
        const fixed = fpFromFloat(value);
        const roundTrip = fpToFloat(fixed);
        expect(Math.abs(roundTrip - value)).toBeLessThan(0.0001);
      }
    });

    it('handles zero correctly', () => {
      const zero = fpFromFloat(0);
      expect(fpToFloat(zero)).toBe(0);
      expect(fpMul(zero, fpFromFloat(100))).toBe(0);
      expect(fpAdd(zero, fpFromFloat(5))).toBe(fpFromFloat(5));
    });
  });

  describe('division edge cases', () => {
    it('handles division by very small values', () => {
      const a = fpFromFloat(100);
      const b = fpFromFloat(0.1);
      const result = fpDiv(a, b);

      expect(Math.abs(fpToFloat(result) - 1000)).toBeLessThan(1);
    });

    it('returns FP_MAX_SAFE for positive/zero division', () => {
      const result = fpDiv(fpFromFloat(100), 0);
      expect(result).toBe(FP_MAX_SAFE);
    });

    it('returns FP_MIN_SAFE for negative/zero division', () => {
      const result = fpDiv(fpFromFloat(-100), 0);
      expect(result).toBe(FP_MIN_SAFE);
    });

    it('handles division of small by large values', () => {
      const a = fpFromFloat(1);
      const b = fpFromFloat(1000);
      const result = fpDiv(a, b);

      expect(Math.abs(fpToFloat(result) - 0.001)).toBeLessThan(0.0001);
    });

    it('handles negative dividend and divisor', () => {
      const a = fpFromFloat(-10);
      const b = fpFromFloat(-2);
      const result = fpDiv(a, b);

      expect(Math.abs(fpToFloat(result) - 5)).toBeLessThan(0.001);
    });

    it('handles mixed sign division', () => {
      const a = fpFromFloat(10);
      const b = fpFromFloat(-2);
      const result = fpDiv(a, b);

      expect(Math.abs(fpToFloat(result) - -5)).toBeLessThan(0.001);
    });
  });

  describe('fpSqrt edge cases', () => {
    it('returns 0 for zero input', () => {
      expect(fpSqrt(0)).toBe(0);
    });

    it('returns 0 for negative input', () => {
      expect(fpSqrt(fpFromFloat(-4))).toBe(0);
    });

    it('calculates square root correctly for perfect squares', () => {
      const testCases = [
        { input: 4, expected: 2 },
        { input: 9, expected: 3 },
        { input: 16, expected: 4 },
        { input: 100, expected: 10 },
      ];

      for (const { input, expected } of testCases) {
        const result = fpSqrt(fpFromFloat(input));
        expect(Math.abs(fpToFloat(result) - expected)).toBeLessThan(0.01);
      }
    });

    it('calculates square root correctly for non-perfect squares', () => {
      const testCases = [
        { input: 2, expected: Math.sqrt(2) },
        { input: 3, expected: Math.sqrt(3) },
        { input: 5, expected: Math.sqrt(5) },
      ];

      for (const { input, expected } of testCases) {
        const result = fpSqrt(fpFromFloat(input));
        expect(Math.abs(fpToFloat(result) - expected)).toBeLessThan(0.01);
      }
    });

    it('handles large values', () => {
      const input = 10000;
      const result = fpSqrt(fpFromFloat(input));
      expect(Math.abs(fpToFloat(result) - 100)).toBeLessThan(0.1);
    });
  });

  describe('integer square root edge cases', () => {
    it('handles zero', () => {
      expect(integerSqrt(0)).toBe(0);
    });

    it('handles one', () => {
      expect(integerSqrt(1)).toBe(1);
    });

    it('handles negative values', () => {
      expect(integerSqrt(-5)).toBe(0);
    });

    it('handles perfect squares', () => {
      expect(integerSqrt(4)).toBe(2);
      expect(integerSqrt(9)).toBe(3);
      expect(integerSqrt(16)).toBe(4);
      expect(integerSqrt(100)).toBe(10);
      expect(integerSqrt(10000)).toBe(100);
    });

    it('handles non-perfect squares (floors result)', () => {
      expect(integerSqrt(2)).toBe(1);
      expect(integerSqrt(3)).toBe(1);
      expect(integerSqrt(5)).toBe(2);
      expect(integerSqrt(8)).toBe(2);
      expect(integerSqrt(10)).toBe(3);
      expect(integerSqrt(99)).toBe(9);
    });

    it('handles large values near 32-bit boundary', () => {
      expect(integerSqrt(0x7fffffff)).toBe(46340);
    });

    it('handles very large values using BigInt path', () => {
      // Values > 0x7FFFFFFF use BigInt internally
      expect(integerSqrt(0x80000000)).toBe(46340);
      expect(integerSqrt(0x100000000)).toBe(65536);
    });
  });

  describe('integer conversion edge cases', () => {
    it('converts integers to fixed-point correctly', () => {
      expect(fpToFloat(fpFromInt(5))).toBe(5);
      expect(fpToFloat(fpFromInt(-5))).toBe(-5);
      expect(fpToFloat(fpFromInt(0))).toBe(0);
    });

    it('truncates fixed-point to integer correctly', () => {
      expect(fpToInt(fpFromFloat(5.9))).toBe(5);
      expect(fpToInt(fpFromFloat(5.1))).toBe(5);
      expect(fpToInt(fpFromFloat(-5.9))).toBe(-6); // Floor behavior
    });
  });

  describe('deterministic distance edge cases', () => {
    it('handles zero distance', () => {
      expect(deterministicDistance(5, 5, 5, 5)).toBe(0);
    });

    it('handles negative coordinates', () => {
      const dist = deterministicDistance(-3, 0, 0, -4);
      expect(Math.abs(dist - 5)).toBeLessThan(0.01);
    });

    it('handles large coordinates', () => {
      const dist = deterministicDistance(0, 0, 300, 400);
      expect(Math.abs(dist - 500)).toBeLessThan(0.1);
    });

    it('produces consistent results across calls', () => {
      const dist1 = deterministicDistance(10.5, 20.3, 30.7, 40.9);
      const dist2 = deterministicDistance(10.5, 20.3, 30.7, 40.9);
      expect(dist1).toBe(dist2);
    });
  });

  describe('deterministic distance squared', () => {
    it('returns zero for same point', () => {
      expect(deterministicDistanceSquared(5, 5, 5, 5)).toBe(0);
    });

    it('calculates squared distance correctly', () => {
      const distSq = deterministicDistanceSquared(0, 0, 3, 4);
      expect(Math.abs(distSq - 25)).toBeLessThan(0.01);
    });
  });

  describe('deterministic normalize', () => {
    it('normalizes unit vectors correctly', () => {
      const result = deterministicNormalize(1, 0);
      expect(Math.abs(result.x - 1)).toBeLessThan(0.01);
      expect(Math.abs(result.y)).toBeLessThan(0.01);
    });

    it('normalizes diagonal vectors', () => {
      const result = deterministicNormalize(1, 1);
      const expected = 1 / Math.sqrt(2);
      expect(Math.abs(result.x - expected)).toBeLessThan(0.01);
      expect(Math.abs(result.y - expected)).toBeLessThan(0.01);
    });

    it('handles zero vector', () => {
      const result = deterministicNormalize(0, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('quantization edge cases', () => {
    it('quantizes very small values', () => {
      const quantized = quantize(0.0001, QUANT_POSITION);
      expect(quantized).toBe(0);
    });

    it('quantizes negative values', () => {
      const quantized = quantize(-5.5, QUANT_POSITION);
      const dequantized = dequantize(quantized, QUANT_POSITION);
      expect(Math.abs(dequantized - -5.5)).toBeLessThan(0.001);
    });

    it('snap position preserves precision', () => {
      const snapped = snapPosition(10.12345, 20.6789);
      expect(Math.abs(snapped.x - 10.123)).toBeLessThan(0.001);
      expect(Math.abs(snapped.y - 20.679)).toBeLessThan(0.001);
    });

    it('snap value works with custom precision', () => {
      const snapped = snapValue(3.14159, 100);
      expect(Math.abs(snapped - 3.14)).toBeLessThan(0.01);
    });
  });

  describe('deterministic damage edge cases', () => {
    it('handles zero base damage', () => {
      const damage = deterministicDamage(0, 1, 0);
      expect(damage).toBe(1); // Minimum 1 damage
    });

    it('handles high armor reducing to minimum', () => {
      const damage = deterministicDamage(5, 1, 100);
      expect(damage).toBe(1); // Minimum 1 damage
    });

    it('handles damage multiplier correctly', () => {
      const damage = deterministicDamage(10, 2, 0);
      expect(Math.abs(damage - 20)).toBeLessThan(0.1);
    });

    it('handles fractional multipliers', () => {
      const damage = deterministicDamage(10, 0.5, 0);
      expect(Math.abs(damage - 5)).toBeLessThan(0.1);
    });

    it('applies armor reduction correctly', () => {
      const damage = deterministicDamage(20, 1, 5);
      expect(Math.abs(damage - 15)).toBeLessThan(0.1);
    });
  });

  describe('multiplication correctness', () => {
    it('multiplies positive × positive correctly', () => {
      const result = fpMul(fpFromFloat(3), fpFromFloat(4));
      expect(Math.abs(fpToFloat(result) - 12)).toBeLessThan(0.001);
    });

    it('multiplies positive × negative correctly', () => {
      const result = fpMul(fpFromFloat(3), fpFromFloat(-4));
      expect(Math.abs(fpToFloat(result) - -12)).toBeLessThan(0.001);
    });

    it('multiplies negative × negative correctly', () => {
      const result = fpMul(fpFromFloat(-3), fpFromFloat(-4));
      expect(Math.abs(fpToFloat(result) - 12)).toBeLessThan(0.001);
    });

    it('multiplies by one correctly', () => {
      const value = fpFromFloat(42.5);
      const result = fpMul(value, fpFromFloat(1));
      expect(Math.abs(fpToFloat(result) - 42.5)).toBeLessThan(0.001);
    });

    it('multiplies by zero correctly', () => {
      const value = fpFromFloat(42.5);
      const result = fpMul(value, fpFromFloat(0));
      expect(fpToFloat(result)).toBe(0);
    });
  });
});

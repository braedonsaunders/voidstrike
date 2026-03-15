import { describe, expect, it } from 'vitest';
import {
  QUANT_DAMAGE,
  QUANT_POSITION,
  dequantize,
  deterministicDamage,
  deterministicDistance,
  deterministicDistanceSquared,
  deterministicMagnitude,
  deterministicMagnitude3D,
  deterministicMagnitudeSquared,
  deterministicNormalize,
  deterministicNormalize3DWithMagnitude,
  deterministicNormalizeWithMagnitude,
  deterministicSqrt,
  integerSqrt,
  quantize,
  snapPosition,
  snapValue,
} from '@/utils/DeterministicMath';

describe('DeterministicMath', () => {
  describe('quantization', () => {
    it('quantizes and dequantizes consistently', () => {
      const quantized = quantize(3.14159, QUANT_POSITION);

      expect(quantized).toBe(3142);
      expect(Math.abs(dequantize(quantized, QUANT_POSITION) - 3.142)).toBeLessThan(0.001);
    });

    it('snaps positions to the deterministic grid', () => {
      const snapped = snapPosition(10.12345, 20.6789);

      expect(snapped.x).toBe(10.123);
      expect(snapped.y).toBe(20.679);
    });

    it('snaps single values with custom precision', () => {
      expect(snapValue(3.14159, 100)).toBe(3.14);
    });
  });

  describe('integer square root', () => {
    it('handles base cases and perfect squares', () => {
      expect(integerSqrt(0)).toBe(0);
      expect(integerSqrt(1)).toBe(1);
      expect(integerSqrt(16)).toBe(4);
      expect(integerSqrt(10000)).toBe(100);
    });

    it('floors non-perfect squares', () => {
      expect(integerSqrt(2)).toBe(1);
      expect(integerSqrt(15)).toBe(3);
      expect(integerSqrt(99)).toBe(9);
    });

    it('uses the BigInt path for very large values', () => {
      expect(integerSqrt(0x80000000)).toBe(46340);
      expect(integerSqrt(0x100000000)).toBe(65536);
    });
  });

  describe('distance and magnitude', () => {
    it('computes deterministic 2D distance', () => {
      expect(deterministicDistance(0, 0, 3, 4)).toBe(5);
      expect(Math.abs(deterministicDistance(-3, 0, 0, -4) - 5)).toBeLessThan(0.01);
    });

    it('computes deterministic squared distance', () => {
      expect(deterministicDistanceSquared(0, 0, 3, 4)).toBe(25);
      expect(deterministicDistanceSquared(5, 5, 5, 5)).toBe(0);
    });

    it('computes deterministic magnitudes', () => {
      expect(deterministicMagnitude(3, 4)).toBe(5);
      expect(deterministicMagnitudeSquared(3, 4)).toBe(25);
      expect(Math.abs(deterministicMagnitude3D(2, 3, 6) - 7)).toBeLessThan(0.01);
    });

    it('returns stable values across repeated calls', () => {
      const resultA = deterministicDistance(10.5, 20.3, 30.7, 40.9);
      const resultB = deterministicDistance(10.5, 20.3, 30.7, 40.9);

      expect(resultA).toBe(resultB);
    });
  });

  describe('normalization', () => {
    it('normalizes 2D vectors deterministically', () => {
      const result = deterministicNormalize(1, 1);
      const expected = 1 / Math.sqrt(2);

      expect(Math.abs(result.x - expected)).toBeLessThan(0.01);
      expect(Math.abs(result.y - expected)).toBeLessThan(0.01);
    });

    it('returns zero for zero-length 2D vectors', () => {
      expect(deterministicNormalize(0, 0)).toEqual({ x: 0, y: 0 });
      expect(deterministicNormalizeWithMagnitude(0, 0)).toEqual({
        nx: 0,
        ny: 0,
        magnitude: 0,
      });
    });

    it('returns normalized direction plus magnitude for 2D vectors', () => {
      const result = deterministicNormalizeWithMagnitude(3, 4);

      expect(result.magnitude).toBe(5);
      expect(result.nx).toBeCloseTo(0.6, 2);
      expect(result.ny).toBeCloseTo(0.8, 2);
    });

    it('returns normalized direction plus magnitude for 3D vectors', () => {
      const result = deterministicNormalize3DWithMagnitude(2, 3, 6);

      expect(Math.abs(result.magnitude - 7)).toBeLessThan(0.01);
      expect(result.nx).toBeCloseTo(2 / 7, 2);
      expect(result.ny).toBeCloseTo(3 / 7, 2);
      expect(result.nz).toBeCloseTo(6 / 7, 2);
    });
  });

  describe('deterministic square root', () => {
    it('handles zero and negative inputs', () => {
      expect(deterministicSqrt(0)).toBe(0);
      expect(deterministicSqrt(-4)).toBe(0);
    });

    it('handles perfect squares and common non-perfect squares', () => {
      expect(deterministicSqrt(4)).toBe(2);
      expect(deterministicSqrt(9)).toBe(3);
      expect(Math.abs(deterministicSqrt(2) - Math.sqrt(2))).toBeLessThan(0.01);
      expect(Math.abs(deterministicSqrt(5) - Math.sqrt(5))).toBeLessThan(0.01);
    });
  });

  describe('deterministic damage', () => {
    it('applies quantized damage consistently', () => {
      expect(deterministicDamage(10, 2, 0)).toBe(20);
      expect(deterministicDamage(20, 1, 5)).toBe(15);
      expect(deterministicDamage(10, 0.5, 0)).toBe(5);
    });

    it('enforces a minimum damage of one', () => {
      expect(deterministicDamage(0, 1, 0)).toBe(1);
      expect(deterministicDamage(5, 1, 100)).toBe(1);
    });

    it('keeps multiplier precision on the damage grid', () => {
      const scaled = deterministicDamage(10, 1.25, 0);

      expect(quantize(scaled, QUANT_DAMAGE)).toBe(1250);
    });
  });
});

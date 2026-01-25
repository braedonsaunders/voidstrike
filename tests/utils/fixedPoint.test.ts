import { describe, it, expect } from 'vitest';
import {
  FP_MAX_SAFE,
  FP_MIN_SAFE,
  deterministicDamage,
  deterministicDistance,
  fpDiv,
  fpFromFloat,
  fpMul,
  fpToFloat,
  integerSqrt,
  quantize,
  dequantize,
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

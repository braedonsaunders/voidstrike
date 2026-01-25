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
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('FixedPoint utilities', () => {
  it('round-trips floats through fixed-point conversion', () => {
    const value = 1.2345;
    const fixed = fpFromFloat(value);
    const roundTrip = fpToFloat(fixed);

    assert.ok(Math.abs(roundTrip - value) < 0.0002);
  });

  it('multiplies fixed-point values deterministically', () => {
    const a = fpFromFloat(1.5);
    const b = fpFromFloat(-2.25);
    const result = fpMul(a, b);

    assert.ok(Math.abs(fpToFloat(result) + 3.375) < 0.0002);
  });

  it('divides with zero denominator safely', () => {
    assert.strictEqual(fpDiv(10, 0), FP_MAX_SAFE);
    assert.strictEqual(fpDiv(-10, 0), FP_MIN_SAFE);
  });

  it('computes integer square roots deterministically', () => {
    assert.strictEqual(integerSqrt(0), 0);
    assert.strictEqual(integerSqrt(1), 1);
    assert.strictEqual(integerSqrt(15), 3);
    assert.strictEqual(integerSqrt(16), 4);
    assert.strictEqual(integerSqrt(0x80000000), 46340);
  });

  it('computes deterministic distance on quantized coordinates', () => {
    assert.ok(Math.abs(deterministicDistance(0, 0, 3, 4) - 5) < 0.0001);
  });

  it('enforces minimum deterministic damage', () => {
    const damage = deterministicDamage(5, 1, 10);
    assert.strictEqual(damage, 1);
  });

  it('quantizes and dequantizes values consistently', () => {
    const quantized = quantize(3.14159, 1000);
    assert.ok(Math.abs(dequantize(quantized, 1000) - 3.142) < 0.001);
  });
});

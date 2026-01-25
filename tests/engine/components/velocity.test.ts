import { describe, it, expect, beforeEach } from 'vitest';
import { Velocity } from '@/engine/components/Velocity';

describe('Velocity Component', () => {
  let velocity: Velocity;

  beforeEach(() => {
    velocity = new Velocity(3, 4, 5);
  });

  describe('constructor', () => {
    it('sets velocity components', () => {
      expect(velocity.x).toBe(3);
      expect(velocity.y).toBe(4);
      expect(velocity.z).toBe(5);
    });

    it('uses default values', () => {
      const v = new Velocity();

      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });
  });

  describe('set', () => {
    it('updates velocity components', () => {
      velocity.set(10, 20, 30);

      expect(velocity.x).toBe(10);
      expect(velocity.y).toBe(20);
      expect(velocity.z).toBe(30);
    });

    it('uses default z value', () => {
      velocity.set(10, 20);

      expect(velocity.z).toBe(0);
    });
  });

  describe('setFromAngle', () => {
    it('sets velocity from angle and magnitude', () => {
      velocity.setFromAngle(0, 10);

      expect(velocity.x).toBeCloseTo(10);
      expect(velocity.y).toBeCloseTo(0);
    });

    it('handles 90 degree angle', () => {
      velocity.setFromAngle(Math.PI / 2, 10);

      expect(velocity.x).toBeCloseTo(0);
      expect(velocity.y).toBeCloseTo(10);
    });

    it('handles 45 degree angle', () => {
      velocity.setFromAngle(Math.PI / 4, Math.SQRT2);

      expect(velocity.x).toBeCloseTo(1);
      expect(velocity.y).toBeCloseTo(1);
    });
  });

  describe('getMagnitude', () => {
    it('calculates 2D magnitude', () => {
      const v = new Velocity(3, 4, 0);
      expect(v.getMagnitude()).toBe(5);
    });

    it('calculates 3D magnitude', () => {
      // 3-4-5 in x-y gives 5, then 5-12 gives 13 for z
      const v = new Velocity(3, 4, 12);
      expect(v.getMagnitude()).toBe(13);
    });

    it('returns 0 for zero velocity', () => {
      const v = new Velocity(0, 0, 0);
      expect(v.getMagnitude()).toBe(0);
    });
  });

  describe('normalize', () => {
    it('normalizes to unit length', () => {
      velocity.set(3, 4, 0);
      velocity.normalize();

      expect(velocity.getMagnitude()).toBeCloseTo(1);
      expect(velocity.x).toBeCloseTo(0.6);
      expect(velocity.y).toBeCloseTo(0.8);
    });

    it('handles zero velocity', () => {
      velocity.set(0, 0, 0);
      velocity.normalize();

      expect(velocity.x).toBe(0);
      expect(velocity.y).toBe(0);
      expect(velocity.z).toBe(0);
    });

    it('preserves direction', () => {
      velocity.set(10, 10, 0);
      const ratio = velocity.x / velocity.y;
      velocity.normalize();

      expect(velocity.x / velocity.y).toBeCloseTo(ratio);
    });
  });

  describe('scale', () => {
    it('scales velocity by factor', () => {
      velocity.set(2, 3, 4);
      velocity.scale(2);

      expect(velocity.x).toBe(4);
      expect(velocity.y).toBe(6);
      expect(velocity.z).toBe(8);
    });

    it('handles negative scale', () => {
      velocity.set(2, 3, 4);
      velocity.scale(-1);

      expect(velocity.x).toBe(-2);
      expect(velocity.y).toBe(-3);
      expect(velocity.z).toBe(-4);
    });

    it('handles zero scale', () => {
      velocity.scale(0);

      expect(velocity.x).toBe(0);
      expect(velocity.y).toBe(0);
      expect(velocity.z).toBe(0);
    });
  });

  describe('zero', () => {
    it('sets all components to zero', () => {
      velocity.zero();

      expect(velocity.x).toBe(0);
      expect(velocity.y).toBe(0);
      expect(velocity.z).toBe(0);
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      expect(velocity.type).toBe('Velocity');
    });
  });
});

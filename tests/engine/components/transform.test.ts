import { describe, it, expect, beforeEach } from 'vitest';
import { Transform } from '@/engine/components/Transform';

describe('Transform Component', () => {
  let transform: Transform;

  beforeEach(() => {
    transform = new Transform(10, 20, 5, Math.PI / 4, 1, 2, 3);
  });

  describe('constructor', () => {
    it('sets position', () => {
      expect(transform.x).toBe(10);
      expect(transform.y).toBe(20);
      expect(transform.z).toBe(5);
    });

    it('sets rotation', () => {
      expect(transform.rotation).toBe(Math.PI / 4);
    });

    it('sets scale', () => {
      expect(transform.scaleX).toBe(1);
      expect(transform.scaleY).toBe(2);
      expect(transform.scaleZ).toBe(3);
    });

    it('initializes previous position to current', () => {
      expect(transform.prevX).toBe(10);
      expect(transform.prevY).toBe(20);
      expect(transform.prevZ).toBe(5);
      expect(transform.prevRotation).toBe(Math.PI / 4);
    });

    it('uses default values', () => {
      const t = new Transform();

      expect(t.x).toBe(0);
      expect(t.y).toBe(0);
      expect(t.z).toBe(0);
      expect(t.rotation).toBe(0);
      expect(t.scaleX).toBe(1);
      expect(t.scaleY).toBe(1);
      expect(t.scaleZ).toBe(1);
    });
  });

  describe('setPosition', () => {
    it('updates position and stores previous', () => {
      transform.setPosition(50, 60, 10);

      expect(transform.x).toBe(50);
      expect(transform.y).toBe(60);
      expect(transform.z).toBe(10);
      expect(transform.prevX).toBe(10);
      expect(transform.prevY).toBe(20);
      expect(transform.prevZ).toBe(5);
    });

    it('preserves z if not provided', () => {
      transform.setPosition(50, 60);

      expect(transform.x).toBe(50);
      expect(transform.y).toBe(60);
      expect(transform.z).toBe(5); // Unchanged
    });
  });

  describe('translate', () => {
    it('moves position by delta', () => {
      transform.translate(5, 10, 2);

      expect(transform.x).toBe(15);
      expect(transform.y).toBe(30);
      expect(transform.z).toBe(7);
    });

    it('stores previous position', () => {
      transform.translate(5, 10);

      expect(transform.prevX).toBe(10);
      expect(transform.prevY).toBe(20);
    });

    it('handles negative deltas', () => {
      transform.translate(-5, -10, -2);

      expect(transform.x).toBe(5);
      expect(transform.y).toBe(10);
      expect(transform.z).toBe(3);
    });
  });

  describe('distanceTo', () => {
    it('calculates distance to another transform', () => {
      const other = new Transform(13, 24); // 3-4-5 triangle

      expect(transform.distanceTo(other)).toBe(5);
    });

    it('returns 0 for same position', () => {
      const other = new Transform(10, 20);

      expect(transform.distanceTo(other)).toBe(0);
    });
  });

  describe('distanceToPoint', () => {
    it('calculates distance to a point', () => {
      expect(transform.distanceToPoint(13, 24)).toBe(5);
    });

    it('returns 0 for same position', () => {
      expect(transform.distanceToPoint(10, 20)).toBe(0);
    });
  });

  describe('setRotation', () => {
    it('updates rotation and stores previous', () => {
      transform.setRotation(Math.PI);

      expect(transform.rotation).toBe(Math.PI);
      expect(transform.prevRotation).toBe(Math.PI / 4);
    });
  });

  describe('lookAt', () => {
    it('rotates to face a point', () => {
      const t = new Transform(0, 0);

      // Look right (positive x)
      t.lookAt(10, 0);
      expect(t.rotation).toBe(0);

      // Look up (positive y)
      t.lookAt(0, 10);
      expect(t.rotation).toBe(Math.PI / 2);

      // Look left (negative x)
      t.lookAt(-10, 0);
      expect(Math.abs(t.rotation - Math.PI)).toBeLessThan(0.0001);

      // Look down (negative y)
      t.lookAt(0, -10);
      expect(t.rotation).toBe(-Math.PI / 2);
    });

    it('stores previous rotation', () => {
      transform.lookAt(100, 20);

      expect(transform.prevRotation).toBe(Math.PI / 4);
    });
  });

  describe('clone', () => {
    it('creates a copy with same values', () => {
      const clone = transform.clone();

      expect(clone.x).toBe(transform.x);
      expect(clone.y).toBe(transform.y);
      expect(clone.z).toBe(transform.z);
      expect(clone.rotation).toBe(transform.rotation);
      expect(clone.scaleX).toBe(transform.scaleX);
      expect(clone.scaleY).toBe(transform.scaleY);
      expect(clone.scaleZ).toBe(transform.scaleZ);
    });

    it('creates an independent copy', () => {
      const clone = transform.clone();
      clone.x = 999;

      expect(transform.x).toBe(10);
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      expect(transform.type).toBe('Transform');
    });
  });
});

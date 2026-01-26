import { describe, it, expect, beforeEach } from 'vitest';

/**
 * ProjectileSystem Tests
 *
 * Tests for projectile physics:
 * 1. Linear movement
 * 2. Ballistic arc calculation
 * 3. Homing behavior
 * 4. Impact detection
 * 5. Splash damage falloff
 */

describe('ProjectileSystem', () => {
  describe('linear movement', () => {
    interface Projectile {
      x: number;
      y: number;
      z: number;
      velocityX: number;
      velocityY: number;
      velocityZ: number;
    }

    function updateLinear(projectile: Projectile, dt: number): Projectile {
      return {
        ...projectile,
        x: projectile.x + projectile.velocityX * dt,
        y: projectile.y + projectile.velocityY * dt,
        z: projectile.z + projectile.velocityZ * dt,
      };
    }

    it('moves in direction of velocity', () => {
      const proj: Projectile = { x: 0, y: 0, z: 0, velocityX: 10, velocityY: 0, velocityZ: 0 };
      const result = updateLinear(proj, 1);
      expect(result.x).toBe(10);
      expect(result.y).toBe(0);
    });

    it('scales with delta time', () => {
      const proj: Projectile = { x: 0, y: 0, z: 0, velocityX: 10, velocityY: 5, velocityZ: 0 };
      const result = updateLinear(proj, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(2.5);
    });

    it('handles 3D movement', () => {
      const proj: Projectile = { x: 0, y: 0, z: 0, velocityX: 1, velocityY: 2, velocityZ: 3 };
      const result = updateLinear(proj, 1);
      expect(result.x).toBe(1);
      expect(result.y).toBe(2);
      expect(result.z).toBe(3);
    });
  });

  describe('ballistic arc', () => {
    function calculateBallisticZ(
      baseZ: number,
      progress: number,
      arcHeight: number
    ): number {
      // Parabolic arc: peaks at progress=0.5, returns to baseZ at progress=1
      return baseZ + arcHeight * 4 * progress * (1 - progress);
    }

    it('starts at base height', () => {
      const z = calculateBallisticZ(1, 0, 5);
      expect(z).toBe(1);
    });

    it('peaks at midpoint', () => {
      const z = calculateBallisticZ(0, 0.5, 5);
      expect(z).toBe(5); // arcHeight at peak
    });

    it('returns to base at end', () => {
      const z = calculateBallisticZ(1, 1, 5);
      expect(z).toBe(1);
    });

    it('is symmetric around midpoint', () => {
      const z25 = calculateBallisticZ(0, 0.25, 10);
      const z75 = calculateBallisticZ(0, 0.75, 10);
      expect(z25).toBeCloseTo(z75, 5);
    });

    it('handles elevated base', () => {
      const z = calculateBallisticZ(10, 0.5, 5);
      expect(z).toBe(15);
    });
  });

  describe('homing direction', () => {
    function normalize3D(x: number, y: number, z: number): { x: number; y: number; z: number } {
      const length = Math.sqrt(x * x + y * y + z * z);
      if (length === 0) return { x: 0, y: 0, z: 0 };
      return { x: x / length, y: y / length, z: z / length };
    }

    function getHomingDirection(
      projX: number,
      projY: number,
      projZ: number,
      targetX: number,
      targetY: number,
      targetZ: number
    ): { x: number; y: number; z: number } {
      const dx = targetX - projX;
      const dy = targetY - projY;
      const dz = targetZ - projZ;
      return normalize3D(dx, dy, dz);
    }

    it('points toward target', () => {
      const dir = getHomingDirection(0, 0, 0, 10, 0, 0);
      expect(dir.x).toBeCloseTo(1, 5);
      expect(dir.y).toBeCloseTo(0, 5);
      expect(dir.z).toBeCloseTo(0, 5);
    });

    it('normalizes to unit length', () => {
      const dir = getHomingDirection(0, 0, 0, 3, 4, 0);
      const length = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2);
      expect(length).toBeCloseTo(1, 5);
    });

    it('handles 3D targeting', () => {
      const dir = getHomingDirection(0, 0, 0, 1, 1, 1);
      const expected = 1 / Math.sqrt(3);
      expect(dir.x).toBeCloseTo(expected, 5);
      expect(dir.y).toBeCloseTo(expected, 5);
      expect(dir.z).toBeCloseTo(expected, 5);
    });

    it('handles same position', () => {
      const dir = getHomingDirection(5, 5, 5, 5, 5, 5);
      expect(dir.x).toBe(0);
      expect(dir.y).toBe(0);
      expect(dir.z).toBe(0);
    });
  });

  describe('impact detection', () => {
    function distance3D(
      x1: number,
      y1: number,
      z1: number,
      x2: number,
      y2: number,
      z2: number
    ): number {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dz = z2 - z1;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function checkImpact(
      projX: number,
      projY: number,
      projZ: number,
      targetX: number,
      targetY: number,
      targetZ: number,
      impactRadius: number
    ): boolean {
      return distance3D(projX, projY, projZ, targetX, targetY, targetZ) <= impactRadius;
    }

    it('detects impact at target', () => {
      expect(checkImpact(10, 10, 0, 10, 10, 0, 1)).toBe(true);
    });

    it('detects impact within radius', () => {
      expect(checkImpact(10, 10.5, 0, 10, 10, 0, 1)).toBe(true);
    });

    it('no impact outside radius', () => {
      expect(checkImpact(10, 12, 0, 10, 10, 0, 1)).toBe(false);
    });

    it('considers 3D distance', () => {
      expect(checkImpact(10, 10, 0.5, 10, 10, 0, 1)).toBe(true);
      expect(checkImpact(10, 10, 2, 10, 10, 0, 1)).toBe(false);
    });
  });

  describe('splash damage falloff', () => {
    function calculateSplashDamage(
      baseDamage: number,
      distance: number,
      splashRadius: number,
      splashFalloff: number
    ): number {
      if (distance > splashRadius) return 0;
      const falloffFactor = 1 - (distance / splashRadius) * splashFalloff;
      return Math.max(0, Math.floor(baseDamage * falloffFactor));
    }

    it('full damage at center', () => {
      const damage = calculateSplashDamage(100, 0, 5, 0.5);
      expect(damage).toBe(100);
    });

    it('reduced damage at edge with falloff', () => {
      const damage = calculateSplashDamage(100, 5, 5, 0.5);
      expect(damage).toBe(50); // 1 - (5/5) * 0.5 = 0.5
    });

    it('no damage beyond radius', () => {
      const damage = calculateSplashDamage(100, 6, 5, 0.5);
      expect(damage).toBe(0);
    });

    it('linear falloff at half radius', () => {
      const damage = calculateSplashDamage(100, 2.5, 5, 0.5);
      expect(damage).toBe(75); // 1 - (2.5/5) * 0.5 = 0.75
    });

    it('no falloff when factor is 0', () => {
      const damage = calculateSplashDamage(100, 4, 5, 0);
      expect(damage).toBe(100);
    });

    it('full falloff when factor is 1', () => {
      const damage = calculateSplashDamage(100, 5, 5, 1);
      expect(damage).toBe(0);
    });
  });

  describe('projectile progress', () => {
    function calculateProgress(
      startX: number,
      startY: number,
      currentX: number,
      currentY: number,
      targetX: number,
      targetY: number
    ): number {
      const totalDist = Math.sqrt((targetX - startX) ** 2 + (targetY - startY) ** 2);
      const currentDist = Math.sqrt((currentX - startX) ** 2 + (currentY - startY) ** 2);
      if (totalDist === 0) return 1;
      return Math.min(1, currentDist / totalDist);
    }

    it('starts at 0', () => {
      const progress = calculateProgress(0, 0, 0, 0, 10, 0);
      expect(progress).toBe(0);
    });

    it('halfway is 0.5', () => {
      const progress = calculateProgress(0, 0, 5, 0, 10, 0);
      expect(progress).toBe(0.5);
    });

    it('at target is 1', () => {
      const progress = calculateProgress(0, 0, 10, 0, 10, 0);
      expect(progress).toBe(1);
    });

    it('caps at 1', () => {
      const progress = calculateProgress(0, 0, 15, 0, 10, 0);
      expect(progress).toBe(1);
    });

    it('handles same start and target', () => {
      const progress = calculateProgress(5, 5, 5, 5, 5, 5);
      expect(progress).toBe(1);
    });
  });
});

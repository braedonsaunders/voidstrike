import { describe, it, expect } from 'vitest';
import { Projectile, ProjectileBehavior, ProjectileTrailType } from '@/engine/components/Projectile';

function createProjectileData(overrides: Partial<Parameters<typeof Projectile.prototype['constructor']>[0]> = {}) {
  return {
    projectileId: 'bullet_rifle',
    sourceEntityId: 1,
    sourcePlayerId: 'player1',
    sourceFaction: 'terran',
    behavior: 'homing' as ProjectileBehavior,
    targetEntityId: 2,
    targetX: 100,
    targetY: 200,
    targetZ: 0,
    startZ: 0,
    speed: 20,
    turnRate: Infinity,
    arcHeight: 0,
    damage: 10,
    rawDamage: 10,
    damageType: 'normal' as const,
    splashRadius: 0,
    splashFalloff: 1,
    spawnTick: 0,
    maxLifetimeTicks: 300,
    trailType: 'bullet' as ProjectileTrailType,
    visualScale: 1,
    ...overrides,
  };
}

describe('Projectile Component', () => {
  describe('constructor', () => {
    it('sets identity properties', () => {
      const projectile = new Projectile(createProjectileData());

      expect(projectile.projectileId).toBe('bullet_rifle');
      expect(projectile.sourceEntityId).toBe(1);
      expect(projectile.sourcePlayerId).toBe('player1');
      expect(projectile.sourceFaction).toBe('terran');
    });

    it('sets behavior type', () => {
      const homing = new Projectile(createProjectileData({ behavior: 'homing' }));
      expect(homing.behavior).toBe('homing');

      const ballistic = new Projectile(createProjectileData({ behavior: 'ballistic' }));
      expect(ballistic.behavior).toBe('ballistic');

      const linear = new Projectile(createProjectileData({ behavior: 'linear' }));
      expect(linear.behavior).toBe('linear');
    });

    it('sets targeting properties', () => {
      const projectile = new Projectile(createProjectileData({
        targetEntityId: 42,
        targetX: 150,
        targetY: 250,
        targetZ: 5,
      }));

      expect(projectile.targetEntityId).toBe(42);
      expect(projectile.targetX).toBe(150);
      expect(projectile.targetY).toBe(250);
      expect(projectile.targetZ).toBe(5);
    });

    it('sets movement properties', () => {
      const projectile = new Projectile(createProjectileData({
        speed: 30,
        turnRate: 0.5,
        arcHeight: 10,
        startZ: 2,
      }));

      expect(projectile.speed).toBe(30);
      expect(projectile.turnRate).toBe(0.5);
      expect(projectile.arcHeight).toBe(10);
      expect(projectile.startZ).toBe(2);
    });

    it('initializes velocity to zero', () => {
      const projectile = new Projectile(createProjectileData());

      expect(projectile.velocityX).toBe(0);
      expect(projectile.velocityY).toBe(0);
      expect(projectile.velocityZ).toBe(0);
    });

    it('sets damage properties', () => {
      const projectile = new Projectile(createProjectileData({
        damage: 25,
        rawDamage: 20,
        damageType: 'explosive',
        splashRadius: 2,
        splashFalloff: 0.5,
      }));

      expect(projectile.damage).toBe(25);
      expect(projectile.rawDamage).toBe(20);
      expect(projectile.damageType).toBe('explosive');
      expect(projectile.splashRadius).toBe(2);
      expect(projectile.splashFalloff).toBe(0.5);
    });

    it('sets lifecycle properties', () => {
      const projectile = new Projectile(createProjectileData({
        spawnTick: 100,
        maxLifetimeTicks: 500,
      }));

      expect(projectile.spawnTick).toBe(100);
      expect(projectile.maxLifetimeTicks).toBe(500);
      expect(projectile.hasImpacted).toBe(false);
    });

    it('sets visual properties', () => {
      const projectile = new Projectile(createProjectileData({
        trailType: 'plasma',
        visualScale: 1.5,
      }));

      expect(projectile.trailType).toBe('plasma');
      expect(projectile.visualScale).toBe(1.5);
    });
  });

  describe('clearSource', () => {
    it('sets source entity to -1', () => {
      const projectile = new Projectile(createProjectileData({ sourceEntityId: 42 }));

      projectile.clearSource();

      expect(projectile.sourceEntityId).toBe(-1);
    });

    it('preserves other properties', () => {
      const projectile = new Projectile(createProjectileData({
        sourceEntityId: 42,
        targetEntityId: 10,
        damage: 25,
      }));

      projectile.clearSource();

      expect(projectile.targetEntityId).toBe(10);
      expect(projectile.damage).toBe(25);
    });
  });

  describe('clearTarget', () => {
    it('sets target entity to null', () => {
      const projectile = new Projectile(createProjectileData({ targetEntityId: 42 }));

      projectile.clearTarget();

      expect(projectile.targetEntityId).toBe(null);
    });

    it('preserves target position', () => {
      const projectile = new Projectile(createProjectileData({
        targetEntityId: 42,
        targetX: 100,
        targetY: 200,
      }));

      projectile.clearTarget();

      expect(projectile.targetX).toBe(100);
      expect(projectile.targetY).toBe(200);
    });
  });

  describe('projectile types', () => {
    it('supports homing projectiles', () => {
      const projectile = new Projectile(createProjectileData({
        behavior: 'homing',
        turnRate: Infinity,
      }));

      expect(projectile.behavior).toBe('homing');
      expect(projectile.turnRate).toBe(Infinity);
    });

    it('supports ballistic projectiles', () => {
      const projectile = new Projectile(createProjectileData({
        behavior: 'ballistic',
        arcHeight: 5,
        startZ: 1,
      }));

      expect(projectile.behavior).toBe('ballistic');
      expect(projectile.arcHeight).toBe(5);
    });

    it('supports linear projectiles', () => {
      const projectile = new Projectile(createProjectileData({
        behavior: 'linear',
        arcHeight: 0,
      }));

      expect(projectile.behavior).toBe('linear');
      expect(projectile.arcHeight).toBe(0);
    });
  });

  describe('damage types', () => {
    it('supports normal damage', () => {
      const projectile = new Projectile(createProjectileData({ damageType: 'normal' }));
      expect(projectile.damageType).toBe('normal');
    });

    it('supports explosive damage', () => {
      const projectile = new Projectile(createProjectileData({ damageType: 'explosive' }));
      expect(projectile.damageType).toBe('explosive');
    });

    it('supports concussive damage', () => {
      const projectile = new Projectile(createProjectileData({ damageType: 'concussive' }));
      expect(projectile.damageType).toBe('concussive');
    });

    it('supports psionic damage', () => {
      const projectile = new Projectile(createProjectileData({ damageType: 'psionic' }));
      expect(projectile.damageType).toBe('psionic');
    });

    it('supports torpedo damage', () => {
      const projectile = new Projectile(createProjectileData({ damageType: 'torpedo' }));
      expect(projectile.damageType).toBe('torpedo');
    });
  });

  describe('trail types', () => {
    it('supports all trail types', () => {
      const trailTypes: ProjectileTrailType[] = ['bullet', 'plasma', 'missile', 'shell', 'laser', 'none'];

      for (const trailType of trailTypes) {
        const projectile = new Projectile(createProjectileData({ trailType }));
        expect(projectile.trailType).toBe(trailType);
      }
    });
  });

  describe('splash mechanics', () => {
    it('supports no splash', () => {
      const projectile = new Projectile(createProjectileData({
        splashRadius: 0,
      }));

      expect(projectile.splashRadius).toBe(0);
    });

    it('supports splash damage', () => {
      const projectile = new Projectile(createProjectileData({
        splashRadius: 2.5,
        splashFalloff: 0.5,
      }));

      expect(projectile.splashRadius).toBe(2.5);
      expect(projectile.splashFalloff).toBe(0.5);
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      const projectile = new Projectile(createProjectileData());
      expect(projectile.type).toBe('Projectile');
    });
  });
});

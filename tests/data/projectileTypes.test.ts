import { describe, it, expect } from 'vitest';
import {
  PROJECTILE_TYPES,
  getProjectileType,
  DEFAULT_PROJECTILE,
  isInstantProjectile,
} from '@/data/projectiles/projectileTypes';

describe('Projectile Type Definitions', () => {
  describe('PROJECTILE_TYPES', () => {
    it('defines infantry projectiles', () => {
      expect(PROJECTILE_TYPES.bullet_rifle).toBeDefined();
      expect(PROJECTILE_TYPES.bullet_heavy).toBeDefined();
      expect(PROJECTILE_TYPES.bullet_sniper).toBeDefined();
      expect(PROJECTILE_TYPES.plasma_rifle).toBeDefined();
    });

    it('defines vehicle projectiles', () => {
      expect(PROJECTILE_TYPES.shell_tank).toBeDefined();
      expect(PROJECTILE_TYPES.shell_siege).toBeDefined();
      expect(PROJECTILE_TYPES.shell_artillery).toBeDefined();
      expect(PROJECTILE_TYPES.missile_aa).toBeDefined();
      expect(PROJECTILE_TYPES.missile_ground).toBeDefined();
    });

    it('defines aircraft projectiles', () => {
      expect(PROJECTILE_TYPES.laser_fighter).toBeDefined();
      expect(PROJECTILE_TYPES.laser_heavy).toBeDefined();
      expect(PROJECTILE_TYPES.bomb_air).toBeDefined();
    });

    it('defines naval projectiles', () => {
      expect(PROJECTILE_TYPES.torpedo).toBeDefined();
      expect(PROJECTILE_TYPES.depth_charge).toBeDefined();
    });

    it('defines turret projectiles', () => {
      expect(PROJECTILE_TYPES.turret_light).toBeDefined();
      expect(PROJECTILE_TYPES.turret_heavy).toBeDefined();
      expect(PROJECTILE_TYPES.turret_aa).toBeDefined();
    });

    it('defines ability projectiles', () => {
      expect(PROJECTILE_TYPES.ability_snipe).toBeDefined();
      expect(PROJECTILE_TYPES.ability_power_cannon).toBeDefined();
      expect(PROJECTILE_TYPES.ability_nuke).toBeDefined();
      expect(PROJECTILE_TYPES.ability_nova).toBeDefined();
    });

    it('defines instant weapons', () => {
      expect(PROJECTILE_TYPES.instant_melee).toBeDefined();
      expect(PROJECTILE_TYPES.instant_beam).toBeDefined();
      expect(PROJECTILE_TYPES.instant_flame).toBeDefined();
    });
  });

  describe('projectile behaviors', () => {
    it('bullet_rifle uses homing behavior', () => {
      expect(PROJECTILE_TYPES.bullet_rifle.behavior).toBe('homing');
      expect(PROJECTILE_TYPES.bullet_rifle.turnRate).toBe(Infinity);
    });

    it('shell_siege uses ballistic behavior', () => {
      expect(PROJECTILE_TYPES.shell_siege.behavior).toBe('ballistic');
      expect(PROJECTILE_TYPES.shell_siege.arcHeight).toBeGreaterThan(0);
    });

    it('laser_fighter uses linear behavior', () => {
      expect(PROJECTILE_TYPES.laser_fighter.behavior).toBe('linear');
      expect(PROJECTILE_TYPES.laser_fighter.turnRate).toBe(0);
    });

    it('missile_aa uses homing with limited turn rate', () => {
      expect(PROJECTILE_TYPES.missile_aa.behavior).toBe('homing');
      expect(PROJECTILE_TYPES.missile_aa.turnRate).toBeLessThan(Infinity);
      expect(PROJECTILE_TYPES.missile_aa.turnRate).toBeGreaterThan(0);
    });
  });

  describe('projectile speeds', () => {
    it('sniper bullets are fast', () => {
      expect(PROJECTILE_TYPES.bullet_sniper.speed).toBe(80);
    });

    it('lasers are fastest non-instant', () => {
      expect(PROJECTILE_TYPES.laser_fighter.speed).toBe(90);
    });

    it('artillery is slow', () => {
      expect(PROJECTILE_TYPES.shell_artillery.speed).toBe(15);
    });

    it('torpedoes are slow but deadly', () => {
      expect(PROJECTILE_TYPES.torpedo.speed).toBe(20);
    });

    it('instant weapons have speed >= 9999', () => {
      expect(PROJECTILE_TYPES.instant_melee.speed).toBe(9999);
      expect(PROJECTILE_TYPES.instant_beam.speed).toBe(9999);
      expect(PROJECTILE_TYPES.instant_flame.speed).toBe(9999);
    });
  });

  describe('projectile arc heights', () => {
    it('homing projectiles have zero arc', () => {
      expect(PROJECTILE_TYPES.bullet_rifle.arcHeight).toBe(0);
      expect(PROJECTILE_TYPES.missile_aa.arcHeight).toBe(0);
    });

    it('ballistic projectiles have arc height', () => {
      expect(PROJECTILE_TYPES.shell_siege.arcHeight).toBe(6);
      expect(PROJECTILE_TYPES.shell_artillery.arcHeight).toBe(10);
    });

    it('nuke has maximum arc height', () => {
      expect(PROJECTILE_TYPES.ability_nuke.arcHeight).toBe(40);
    });
  });

  describe('trail types', () => {
    it('bullet projectiles use bullet trail', () => {
      expect(PROJECTILE_TYPES.bullet_rifle.trailType).toBe('bullet');
      expect(PROJECTILE_TYPES.bullet_heavy.trailType).toBe('bullet');
    });

    it('plasma projectiles use plasma trail', () => {
      expect(PROJECTILE_TYPES.plasma_rifle.trailType).toBe('plasma');
      expect(PROJECTILE_TYPES.turret_heavy.trailType).toBe('plasma');
    });

    it('shell projectiles use shell trail', () => {
      expect(PROJECTILE_TYPES.shell_tank.trailType).toBe('shell');
      expect(PROJECTILE_TYPES.shell_siege.trailType).toBe('shell');
    });

    it('missile projectiles use missile trail', () => {
      expect(PROJECTILE_TYPES.missile_aa.trailType).toBe('missile');
      expect(PROJECTILE_TYPES.torpedo.trailType).toBe('missile');
    });

    it('laser projectiles use laser trail', () => {
      expect(PROJECTILE_TYPES.laser_fighter.trailType).toBe('laser');
      expect(PROJECTILE_TYPES.instant_beam.trailType).toBe('laser');
    });

    it('some projectiles have no trail', () => {
      expect(PROJECTILE_TYPES.instant_melee.trailType).toBe('none');
      expect(PROJECTILE_TYPES.depth_charge.trailType).toBe('none');
    });
  });

  describe('projectile scales', () => {
    it('rifle bullets are small', () => {
      expect(PROJECTILE_TYPES.bullet_rifle.scale).toBe(0.3);
    });

    it('ability projectiles are larger', () => {
      expect(PROJECTILE_TYPES.ability_power_cannon.scale).toBe(2.0);
      expect(PROJECTILE_TYPES.ability_nuke.scale).toBe(2.5);
    });

    it('all projectiles have valid scale', () => {
      for (const [id, def] of Object.entries(PROJECTILE_TYPES)) {
        expect(def.scale).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getProjectileType', () => {
    it('returns projectile definition for valid ID', () => {
      const result = getProjectileType('bullet_rifle');

      expect(result).toBe(PROJECTILE_TYPES.bullet_rifle);
    });

    it('returns null for invalid ID', () => {
      const result = getProjectileType('nonexistent');

      expect(result).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(getProjectileType('')).toBe(null);
    });
  });

  describe('DEFAULT_PROJECTILE', () => {
    it('is bullet_rifle', () => {
      expect(DEFAULT_PROJECTILE).toBe(PROJECTILE_TYPES.bullet_rifle);
    });

    it('has reasonable default properties', () => {
      expect(DEFAULT_PROJECTILE.behavior).toBe('homing');
      expect(DEFAULT_PROJECTILE.speed).toBeGreaterThan(0);
    });
  });

  describe('isInstantProjectile', () => {
    it('returns true for instant_melee', () => {
      expect(isInstantProjectile('instant_melee')).toBe(true);
    });

    it('returns true for instant_beam', () => {
      expect(isInstantProjectile('instant_beam')).toBe(true);
    });

    it('returns true for instant_flame', () => {
      expect(isInstantProjectile('instant_flame')).toBe(true);
    });

    it('returns false for regular projectiles', () => {
      expect(isInstantProjectile('bullet_rifle')).toBe(false);
      expect(isInstantProjectile('shell_tank')).toBe(false);
      expect(isInstantProjectile('missile_aa')).toBe(false);
    });

    it('returns false for nonexistent projectile', () => {
      expect(isInstantProjectile('nonexistent')).toBe(false);
    });
  });

  describe('projectile definition structure', () => {
    it('all projectiles have required properties', () => {
      for (const [id, def] of Object.entries(PROJECTILE_TYPES)) {
        expect(def.id).toBe(id);
        expect(['homing', 'ballistic', 'linear']).toContain(def.behavior);
        expect(typeof def.speed).toBe('number');
        expect(typeof def.turnRate).toBe('number');
        expect(typeof def.arcHeight).toBe('number');
        expect(['bullet', 'plasma', 'missile', 'shell', 'laser', 'none']).toContain(def.trailType);
        expect(typeof def.scale).toBe('number');
      }
    });

    it('homing projectiles have positive turn rate', () => {
      for (const def of Object.values(PROJECTILE_TYPES)) {
        if (def.behavior === 'homing') {
          expect(def.turnRate).toBeGreaterThan(0);
        }
      }
    });

    it('linear projectiles have zero turn rate', () => {
      for (const def of Object.values(PROJECTILE_TYPES)) {
        if (def.behavior === 'linear') {
          expect(def.turnRate).toBe(0);
        }
      }
    });

    it('ballistic projectiles have zero or positive arc height', () => {
      for (const def of Object.values(PROJECTILE_TYPES)) {
        if (def.behavior === 'ballistic') {
          expect(def.arcHeight).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});

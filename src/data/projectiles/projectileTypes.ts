/**
 * Projectile Type Definitions
 *
 * Each weapon type references a projectile definition here.
 * Separated from unit data for reusability - multiple units can share projectile types.
 *
 * Behavior types:
 * - homing: Tracks moving target, always hits (most units)
 * - ballistic: Arcs to target position, can miss if target moves (siege weapons)
 * - linear: Straight line, no tracking (lasers)
 *
 * Speed reference (units per second):
 * - Fast bullet: 50-60 (rifles, pistols)
 * - Medium: 30-40 (tank shells, missiles)
 * - Slow: 15-25 (artillery, siege)
 * - Near-instant: 80+ (lasers, sniper)
 */

import { ProjectileDefinition } from '@/engine/components/Projectile';

export const PROJECTILE_TYPES: Record<string, ProjectileDefinition> = {
  // ============================================
  // INFANTRY PROJECTILES
  // ============================================

  bullet_rifle: {
    id: 'bullet_rifle',
    behavior: 'homing',
    speed: 55,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'bullet',
    scale: 0.3,
  },

  bullet_heavy: {
    id: 'bullet_heavy',
    behavior: 'homing',
    speed: 45,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'bullet',
    scale: 0.5,
  },

  bullet_sniper: {
    id: 'bullet_sniper',
    behavior: 'homing',
    speed: 80,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'bullet',
    scale: 0.4,
  },

  plasma_rifle: {
    id: 'plasma_rifle',
    behavior: 'homing',
    speed: 50,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'plasma',
    scale: 0.4,
  },

  // ============================================
  // VEHICLE PROJECTILES
  // ============================================

  shell_tank: {
    id: 'shell_tank',
    behavior: 'homing',
    speed: 35,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'shell',
    scale: 0.7,
  },

  shell_siege: {
    id: 'shell_siege',
    behavior: 'ballistic',
    speed: 20,
    turnRate: 0,
    arcHeight: 6,
    trailType: 'shell',
    scale: 1.0,
  },

  shell_artillery: {
    id: 'shell_artillery',
    behavior: 'ballistic',
    speed: 15,
    turnRate: 0,
    arcHeight: 10,
    trailType: 'shell',
    scale: 1.2,
  },

  missile_aa: {
    id: 'missile_aa',
    behavior: 'homing',
    speed: 45,
    turnRate: 8,
    arcHeight: 0,
    trailType: 'missile',
    scale: 0.5,
  },

  missile_ground: {
    id: 'missile_ground',
    behavior: 'homing',
    speed: 35,
    turnRate: 6,
    arcHeight: 0,
    trailType: 'missile',
    scale: 0.6,
  },

  // ============================================
  // AIRCRAFT PROJECTILES
  // ============================================

  laser_fighter: {
    id: 'laser_fighter',
    behavior: 'linear',
    speed: 90,
    turnRate: 0,
    arcHeight: 0,
    trailType: 'laser',
    scale: 0.3,
  },

  laser_heavy: {
    id: 'laser_heavy',
    behavior: 'linear',
    speed: 70,
    turnRate: 0,
    arcHeight: 0,
    trailType: 'laser',
    scale: 0.6,
  },

  bomb_air: {
    id: 'bomb_air',
    behavior: 'ballistic',
    speed: 25,
    turnRate: 0,
    arcHeight: 0,
    trailType: 'none',
    scale: 0.8,
  },

  // ============================================
  // NAVAL PROJECTILES
  // ============================================

  torpedo: {
    id: 'torpedo',
    behavior: 'homing',
    speed: 20, // Slow but deadly
    turnRate: 3, // Can track but slowly
    arcHeight: 0,
    trailType: 'missile', // Uses missile trail effect
    scale: 0.8,
  },

  depth_charge: {
    id: 'depth_charge',
    behavior: 'ballistic',
    speed: 15,
    turnRate: 0,
    arcHeight: 2,
    trailType: 'none',
    scale: 0.6,
  },

  // ============================================
  // BUILDING / TURRET PROJECTILES
  // ============================================

  turret_light: {
    id: 'turret_light',
    behavior: 'homing',
    speed: 50,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'bullet',
    scale: 0.4,
  },

  turret_heavy: {
    id: 'turret_heavy',
    behavior: 'homing',
    speed: 40,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'plasma',
    scale: 0.7,
  },

  turret_aa: {
    id: 'turret_aa',
    behavior: 'homing',
    speed: 55,
    turnRate: 10,
    arcHeight: 0,
    trailType: 'missile',
    scale: 0.5,
  },

  // ============================================
  // ABILITY PROJECTILES
  // ============================================

  ability_snipe: {
    id: 'ability_snipe',
    behavior: 'homing',
    speed: 100,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'laser',
    scale: 0.5,
  },

  ability_power_cannon: {
    id: 'ability_power_cannon',
    behavior: 'linear',
    speed: 25,
    turnRate: 0,
    arcHeight: 0,
    trailType: 'plasma',
    scale: 2.0,
  },

  ability_nuke: {
    id: 'ability_nuke',
    behavior: 'ballistic',
    speed: 8,
    turnRate: 0,
    arcHeight: 40,
    trailType: 'missile',
    scale: 2.5,
  },

  ability_nova: {
    id: 'ability_nova',
    behavior: 'homing',
    speed: 60,
    turnRate: Infinity,
    arcHeight: 0,
    trailType: 'plasma',
    scale: 1.0,
  },

  // ============================================
  // INSTANT WEAPONS (no visible projectile travel)
  // ============================================
  // Speed >= 9999 means damage is applied instantly
  // Visual effect (beam, etc.) is still shown

  instant_melee: {
    id: 'instant_melee',
    behavior: 'linear',
    speed: 9999,
    turnRate: 0,
    arcHeight: 0,
    trailType: 'none',
    scale: 0,
  },

  instant_beam: {
    id: 'instant_beam',
    behavior: 'linear',
    speed: 9999,
    turnRate: 0,
    arcHeight: 0,
    trailType: 'laser',
    scale: 0.3,
  },

  instant_flame: {
    id: 'instant_flame',
    behavior: 'linear',
    speed: 9999,
    turnRate: 0,
    arcHeight: 0,
    trailType: 'none',
    scale: 0,
  },
};

/**
 * Get projectile definition by ID
 */
export function getProjectileType(id: string): ProjectileDefinition | null {
  return PROJECTILE_TYPES[id] ?? null;
}

/**
 * Default projectile for units without explicit projectile type
 */
export const DEFAULT_PROJECTILE: ProjectileDefinition = PROJECTILE_TYPES.bullet_rifle;

/**
 * Check if a projectile type is instant (no travel time)
 */
export function isInstantProjectile(projectileId: string): boolean {
  const def = PROJECTILE_TYPES[projectileId];
  return def ? def.speed >= 9999 : false;
}

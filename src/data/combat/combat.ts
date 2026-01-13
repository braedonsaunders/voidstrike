/**
 * Combat Configuration - Data-Driven Damage and Armor System
 *
 * This file defines all combat-related types and multipliers in a data-driven way.
 * To create a different game (e.g., Age of Empires clone), simply modify these definitions.
 *
 * Example configurations:
 * - Sci-fi RTS: normal, explosive, concussive, psionic damage
 * - Medieval RTS: melee, pierce, siege damage
 * - Fantasy RTS: physical, magical, holy, fire damage
 */

// ==================== DAMAGE TYPES ====================

export interface DamageTypeDefinition {
  id: string;
  name: string;
  description: string;
  color?: string; // For UI display
  icon?: string;
}

export const DAMAGE_TYPES: Record<string, DamageTypeDefinition> = {
  normal: {
    id: 'normal',
    name: 'Normal',
    description: 'Standard damage with no special properties.',
    color: '#ffffff',
  },
  explosive: {
    id: 'explosive',
    name: 'Explosive',
    description: 'High damage against armored targets, reduced against light units.',
    color: '#ff6600',
  },
  concussive: {
    id: 'concussive',
    name: 'Concussive',
    description: 'Effective against light units, weak against armored targets.',
    color: '#6699ff',
  },
  psionic: {
    id: 'psionic',
    name: 'Psionic',
    description: 'Mental damage that bypasses physical armor.',
    color: '#cc66ff',
  },
};

// ==================== ARMOR TYPES ====================

export interface ArmorTypeDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

export const ARMOR_TYPES: Record<string, ArmorTypeDefinition> = {
  light: {
    id: 'light',
    name: 'Light',
    description: 'Minimal protection, vulnerable to concussive damage.',
  },
  armored: {
    id: 'armored',
    name: 'Armored',
    description: 'Heavy plating, resistant to concussive but weak to explosive.',
  },
  massive: {
    id: 'massive',
    name: 'Massive',
    description: 'Extremely heavy armor, resistant to most damage types.',
  },
  structure: {
    id: 'structure',
    name: 'Structure',
    description: 'Building armor, vulnerable to siege/explosive damage.',
  },
};

// ==================== DAMAGE MULTIPLIERS ====================

/**
 * Damage multiplier matrix: DAMAGE_MULTIPLIERS[damageType][armorType] = multiplier
 *
 * Values:
 * - 1.0 = normal damage
 * - > 1.0 = bonus damage (effective)
 * - < 1.0 = reduced damage (ineffective)
 *
 * To modify for your game, simply change these values or add new types.
 */
export const DAMAGE_MULTIPLIERS: Record<string, Record<string, number>> = {
  normal: {
    light: 1.0,
    armored: 1.0,
    massive: 1.0,
    structure: 1.0,
  },
  explosive: {
    light: 0.5,
    armored: 1.5,
    massive: 1.25,
    structure: 1.5,
  },
  concussive: {
    light: 1.5,
    armored: 0.5,
    massive: 0.25,
    structure: 0.5,
  },
  psionic: {
    light: 1.0,
    armored: 1.0,
    massive: 1.0,
    structure: 0.5,
  },
};

// ==================== TARGET PRIORITY ====================

/**
 * Default target priority values by unit category.
 * Individual units can override with their own targetPriority field.
 *
 * Higher values = more likely to be targeted first.
 */
export const DEFAULT_TARGET_PRIORITIES: Record<string, number> = {
  // Combat categories
  capital_ship: 95,
  heavy_vehicle: 90,
  artillery: 85,
  elite_infantry: 80,
  standard_vehicle: 70,
  standard_infantry: 60,
  light_vehicle: 55,
  light_infantry: 50,
  support: 45,
  scout: 40,
  // Non-combat
  worker: 10,
  structure: 5,
};

// ==================== COMBAT CONSTANTS ====================

export interface CombatConfig {
  // High ground mechanics
  highGroundMissChance: number; // Chance to miss when attacking uphill
  highGroundThreshold: number; // Height difference to count as high ground

  // Attack timing
  attackCooldownBuffer: number; // Buffer time after attack before next attack

  // Splash damage
  splashFalloffEnabled: boolean; // Whether splash damage decreases with distance
  splashFalloffRate: number; // Rate of falloff (1.0 = linear)

  // Overkill prevention
  overkillProtection: boolean; // Prevent multiple units targeting dying enemies

  // Alert system
  underAttackCooldown: number; // Cooldown for "under attack" alerts (ms)
}

export const COMBAT_CONFIG: CombatConfig = {
  highGroundMissChance: 0.3, // 30% miss chance
  highGroundThreshold: 1.5, // Height units
  attackCooldownBuffer: 0.05, // 50ms buffer
  splashFalloffEnabled: true,
  splashFalloffRate: 1.0,
  overkillProtection: true,
  underAttackCooldown: 10000, // 10 seconds
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get damage multiplier for a damage type against an armor type.
 * Returns 1.0 if either type is not found (safe fallback).
 */
export function getDamageMultiplier(damageType: string, armorType: string): number {
  const damageRow = DAMAGE_MULTIPLIERS[damageType];
  if (!damageRow) return 1.0;
  return damageRow[armorType] ?? 1.0;
}

/**
 * Get all registered damage type IDs.
 */
export function getDamageTypeIds(): string[] {
  return Object.keys(DAMAGE_TYPES);
}

/**
 * Get all registered armor type IDs.
 */
export function getArmorTypeIds(): string[] {
  return Object.keys(ARMOR_TYPES);
}

/**
 * Validate that all damage types have multipliers for all armor types.
 * Useful for development/testing.
 */
export function validateCombatConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const damageTypes = getDamageTypeIds();
  const armorTypes = getArmorTypeIds();

  for (const dt of damageTypes) {
    for (const at of armorTypes) {
      if (DAMAGE_MULTIPLIERS[dt]?.[at] === undefined) {
        errors.push(`Missing multiplier: ${dt} vs ${at}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

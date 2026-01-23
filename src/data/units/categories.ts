/**
 * Unit Categories - Data-Driven Unit Classification System
 *
 * This file defines unit categories for organizing units in UI,
 * applying upgrades, and AI targeting decisions.
 *
 * Categories are separate from armor types - a unit can be:
 * - Category: 'infantry' (for UI/upgrades)
 * - Armor: 'light' (for damage calculations)
 *
 * Example configurations:
 * - Sci-fi RTS: infantry, vehicle, ship, structure
 * - Medieval RTS: infantry, cavalry, siege, naval, building
 * - Fantasy RTS: melee, ranged, magic, flying, structure
 */

// ==================== CATEGORY DEFINITIONS ====================

export interface UnitCategoryDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;

  // UI organization
  displayOrder: number; // Order in UI (lower = first)
  color?: string; // Category color for UI

  // Upgrade applicability
  upgradeGroup: string; // Which upgrade tree applies (e.g., 'infantry_weapons')

  // AI behavior
  defaultTargetPriority: number; // Base priority for AI targeting
  isCombatUnit: boolean; // Whether this is a combat category
}

export const UNIT_CATEGORIES: Record<string, UnitCategoryDefinition> = {
  worker: {
    id: 'worker',
    name: 'Worker',
    description: 'Resource gathering and construction units.',
    displayOrder: 0,
    color: '#ffcc00',
    upgradeGroup: 'none',
    defaultTargetPriority: 10,
    isCombatUnit: false,
  },
  infantry: {
    id: 'infantry',
    name: 'Infantry',
    description: 'Ground-based foot soldiers.',
    displayOrder: 1,
    color: '#66ff66',
    upgradeGroup: 'infantry',
    defaultTargetPriority: 60,
    isCombatUnit: true,
  },
  vehicle: {
    id: 'vehicle',
    name: 'Vehicle',
    description: 'Ground-based mechanical units.',
    displayOrder: 2,
    color: '#ff9966',
    upgradeGroup: 'vehicle',
    defaultTargetPriority: 75,
    isCombatUnit: true,
  },
  ship: {
    id: 'ship',
    name: 'Ship',
    description: 'Air and space vessels.',
    displayOrder: 3,
    color: '#66ccff',
    upgradeGroup: 'ship',
    defaultTargetPriority: 80,
    isCombatUnit: true,
  },
  naval: {
    id: 'naval',
    name: 'Naval',
    description: 'Water-based vessels and submarines.',
    displayOrder: 4,
    color: '#3399cc',
    upgradeGroup: 'naval',
    defaultTargetPriority: 75,
    isCombatUnit: true,
  },
  support: {
    id: 'support',
    name: 'Support',
    description: 'Non-combat support units.',
    displayOrder: 5,
    color: '#cc99ff',
    upgradeGroup: 'none',
    defaultTargetPriority: 45,
    isCombatUnit: false,
  },
  hero: {
    id: 'hero',
    name: 'Hero',
    description: 'Powerful unique units.',
    displayOrder: 6,
    color: '#ffff00',
    upgradeGroup: 'hero',
    defaultTargetPriority: 95,
    isCombatUnit: true,
  },
};

// ==================== UNIT TYPE ASSIGNMENTS ====================

/**
 * Maps unit IDs to their categories.
 * This can be overridden in individual unit definitions.
 */
export const UNIT_CATEGORY_ASSIGNMENTS: Record<string, string> = {
  // Workers
  fabricator: 'worker',
  mariner: 'worker',

  // Infantry
  trooper: 'infantry',
  breacher: 'infantry',
  vanguard: 'infantry',
  operative: 'infantry',

  // Vehicles
  scorcher: 'vehicle',
  devastator: 'vehicle',
  colossus: 'vehicle',

  // Ships (Air)
  lifter: 'support',
  valkyrie: 'ship',
  specter: 'ship',
  overseer: 'support',
  dreadnought: 'ship',

  // Naval
  stingray: 'naval',
  corsair: 'naval',
  leviathan: 'naval',
  hunter: 'naval',
  kraken: 'naval',
};

// ==================== SUBCATEGORIES ====================

/**
 * Optional subcategories for more granular classification.
 * Useful for specific upgrade targeting or AI decisions.
 */
export interface SubcategoryDefinition {
  id: string;
  name: string;
  parentCategory: string;
  description: string;
}

export const UNIT_SUBCATEGORIES: Record<string, SubcategoryDefinition> = {
  light_infantry: {
    id: 'light_infantry',
    name: 'Light Infantry',
    parentCategory: 'infantry',
    description: 'Fast, lightly armored infantry.',
  },
  heavy_infantry: {
    id: 'heavy_infantry',
    name: 'Heavy Infantry',
    parentCategory: 'infantry',
    description: 'Slow, heavily armored infantry.',
  },
  light_vehicle: {
    id: 'light_vehicle',
    name: 'Light Vehicle',
    parentCategory: 'vehicle',
    description: 'Fast attack vehicles.',
  },
  heavy_vehicle: {
    id: 'heavy_vehicle',
    name: 'Heavy Vehicle',
    parentCategory: 'vehicle',
    description: 'Slow, powerful vehicles.',
  },
  fighter: {
    id: 'fighter',
    name: 'Fighter',
    parentCategory: 'ship',
    description: 'Air superiority craft.',
  },
  capital_ship: {
    id: 'capital_ship',
    name: 'Capital Ship',
    parentCategory: 'ship',
    description: 'Large, powerful warships.',
  },
  // Naval subcategories
  patrol_boat: {
    id: 'patrol_boat',
    name: 'Patrol Boat',
    parentCategory: 'naval',
    description: 'Fast, light naval craft.',
  },
  frigate: {
    id: 'frigate',
    name: 'Frigate',
    parentCategory: 'naval',
    description: 'Medium escort vessels.',
  },
  battleship: {
    id: 'battleship',
    name: 'Battleship',
    parentCategory: 'naval',
    description: 'Heavy naval capital ships.',
  },
  submarine: {
    id: 'submarine',
    name: 'Submarine',
    parentCategory: 'naval',
    description: 'Stealth underwater vessels.',
  },
  amphibious: {
    id: 'amphibious',
    name: 'Amphibious',
    parentCategory: 'naval',
    description: 'Vessels that operate on water and land.',
  },
};

/**
 * Maps unit IDs to subcategories (optional, more specific than main category).
 */
export const UNIT_SUBCATEGORY_ASSIGNMENTS: Record<string, string> = {
  trooper: 'light_infantry',
  vanguard: 'light_infantry',
  breacher: 'heavy_infantry',
  operative: 'light_infantry',
  scorcher: 'light_vehicle',
  devastator: 'heavy_vehicle',
  colossus: 'heavy_vehicle',
  valkyrie: 'fighter',
  specter: 'fighter',
  dreadnought: 'capital_ship',
  // Naval subcategories
  stingray: 'patrol_boat',
  corsair: 'frigate',
  leviathan: 'battleship',
  hunter: 'submarine',
  kraken: 'amphibious',
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get all registered category IDs.
 */
export function getCategoryIds(): string[] {
  return Object.keys(UNIT_CATEGORIES);
}

/**
 * Get category definition by ID.
 */
export function getCategory(id: string): UnitCategoryDefinition | undefined {
  return UNIT_CATEGORIES[id];
}

/**
 * Get the category for a unit.
 */
export function getUnitCategory(unitId: string): string {
  return UNIT_CATEGORY_ASSIGNMENTS[unitId] ?? 'infantry';
}

/**
 * Get the subcategory for a unit (if any).
 */
export function getUnitSubcategory(unitId: string): string | undefined {
  return UNIT_SUBCATEGORY_ASSIGNMENTS[unitId];
}

/**
 * Get all units in a category.
 */
export function getUnitsInCategory(categoryId: string): string[] {
  return Object.entries(UNIT_CATEGORY_ASSIGNMENTS)
    .filter(([_, cat]) => cat === categoryId)
    .map(([unitId]) => unitId);
}

/**
 * Get default target priority for a unit based on its category.
 */
export function getDefaultTargetPriority(unitId: string): number {
  const category = getUnitCategory(unitId);
  return UNIT_CATEGORIES[category]?.defaultTargetPriority ?? 50;
}

/**
 * Check if a unit is in a combat category.
 */
export function isCombatUnit(unitId: string): boolean {
  const category = getUnitCategory(unitId);
  return UNIT_CATEGORIES[category]?.isCombatUnit ?? true;
}

/**
 * Get categories sorted by display order.
 */
export function getCategoriesSorted(): UnitCategoryDefinition[] {
  return Object.values(UNIT_CATEGORIES).sort((a, b) => a.displayOrder - b.displayOrder);
}

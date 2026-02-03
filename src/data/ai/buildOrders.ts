/**
 * AI Build Orders - Data-Driven AI Strategy System
 *
 * This file defines build orders for AI players at different difficulty levels.
 * Build orders are faction-specific, allowing different races to have unique strategies.
 *
 * To create a new faction's AI:
 * 1. Add a new entry to FACTION_BUILD_ORDERS
 * 2. Define build orders for each difficulty level
 * 3. The AI system will automatically use them
 */

// ==================== BUILD ORDER TYPES ====================

export type BuildOrderStepType = 'unit' | 'building' | 'research' | 'ability';

// Condition can be a named string identifier OR a function for flexibility
export type BuildOrderCondition = string | ((ai: unknown) => boolean);

export interface BuildOrderStep {
  type: BuildOrderStepType;
  id: string; // Unit, building, or research ID
  supply?: number; // Execute at this supply count
  time?: number; // Execute at this game time (seconds)
  condition?: BuildOrderCondition; // Named condition or callback function
  priority?: number; // Override default priority (higher = more important)
  count?: number; // Build this many (default: 1)
  comment?: string; // Documentation for this step
}

export interface BuildOrder {
  id: string;
  name: string;
  description: string;
  faction: string;
  difficulty: AIDifficulty;
  style: BuildOrderStyle;
  steps: BuildOrderStep[];
  // Transition rules
  transitionTo?: string; // Build order ID to switch to after completion
  transitionCondition?: string;
}

export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard' | 'insane';
export type BuildOrderStyle =
  | 'economic'
  | 'aggressive'
  | 'defensive'
  | 'balanced'
  | 'rush'
  | 'turtle';

// ==================== FACTION BUILD ORDERS ====================

/**
 * Build orders organized by faction, then by difficulty.
 * Each faction can have multiple build orders per difficulty for variety.
 */
export const FACTION_BUILD_ORDERS: Record<string, Record<AIDifficulty, BuildOrder[]>> = {
  dominion: {
    easy: [
      {
        id: 'dominion_easy_standard',
        name: 'Basic Infantry',
        description: 'Simple build focusing on basic infantry.',
        faction: 'dominion',
        difficulty: 'easy',
        style: 'balanced',
        steps: [
          { type: 'unit', id: 'fabricator', comment: 'Early worker' },
          { type: 'unit', id: 'fabricator', comment: 'Second worker' },
          { type: 'building', id: 'supply_cache', comment: 'Supply' },
          { type: 'building', id: 'infantry_bay', comment: 'Unit production' },
          { type: 'unit', id: 'trooper', comment: 'First army unit' },
          { type: 'unit', id: 'trooper' },
          { type: 'building', id: 'extractor', supply: 10, comment: 'Gas production' },
        ],
      },
    ],
    medium: [
      {
        id: 'dominion_medium_balanced',
        name: 'Balanced Expansion',
        description: 'Balanced build with tech progression.',
        faction: 'dominion',
        difficulty: 'medium',
        style: 'balanced',
        steps: [
          { type: 'unit', id: 'fabricator' },
          { type: 'unit', id: 'fabricator' },
          { type: 'unit', id: 'fabricator' },
          { type: 'building', id: 'supply_cache' },
          { type: 'building', id: 'infantry_bay' },
          { type: 'building', id: 'extractor' },
          { type: 'unit', id: 'trooper' },
          { type: 'building', id: 'infantry_bay', supply: 14, comment: 'Second production' },
          { type: 'building', id: 'forge', supply: 18 },
          { type: 'building', id: 'research_module', supply: 22, comment: 'Tech for breachers' },
        ],
      },
    ],
    hard: [
      {
        id: 'dominion_hard_tech',
        name: 'Fast Tech',
        description: 'Quick tech into advanced units.',
        faction: 'dominion',
        difficulty: 'hard',
        style: 'aggressive',
        steps: [
          { type: 'unit', id: 'fabricator' },
          { type: 'unit', id: 'fabricator' },
          { type: 'unit', id: 'fabricator' },
          { type: 'building', id: 'supply_cache' },
          { type: 'building', id: 'infantry_bay' },
          { type: 'building', id: 'extractor' },
          { type: 'building', id: 'research_module', supply: 12, comment: 'Early tech' },
          { type: 'building', id: 'forge', supply: 16 },
          { type: 'unit', id: 'breacher' },
          { type: 'building', id: 'research_module', supply: 20, comment: 'Forge tech' },
          { type: 'building', id: 'hangar', supply: 24 },
        ],
      },
    ],
    very_hard: [
      {
        id: 'dominion_vhard_aggressive',
        name: 'Aggressive Expansion',
        description: 'Fast expansion with constant pressure.',
        faction: 'dominion',
        difficulty: 'very_hard',
        style: 'aggressive',
        steps: [
          { type: 'unit', id: 'fabricator' },
          { type: 'unit', id: 'fabricator' },
          { type: 'building', id: 'supply_cache' },
          { type: 'building', id: 'infantry_bay' },
          { type: 'building', id: 'extractor' },
          { type: 'building', id: 'research_module', supply: 10 },
          { type: 'building', id: 'forge', supply: 14 },
          { type: 'building', id: 'research_module', supply: 18 },
          { type: 'building', id: 'hangar', supply: 22 },
          { type: 'building', id: 'infantry_bay', supply: 26 },
          { type: 'building', id: 'research_module', supply: 30 },
        ],
      },
    ],
    insane: [
      {
        id: 'dominion_insane_rush',
        name: 'All-In Rush',
        description: 'Maximum aggression with economy sacrifice.',
        faction: 'dominion',
        difficulty: 'insane',
        style: 'rush',
        steps: [
          { type: 'unit', id: 'fabricator' },
          { type: 'building', id: 'supply_cache' },
          { type: 'building', id: 'infantry_bay' },
          { type: 'building', id: 'extractor' },
          { type: 'building', id: 'research_module', supply: 9 },
          { type: 'building', id: 'forge', supply: 12 },
          { type: 'building', id: 'research_module', supply: 16 },
          { type: 'building', id: 'hangar', supply: 20 },
          { type: 'building', id: 'research_module', supply: 24 },
          { type: 'building', id: 'arsenal', supply: 28 },
        ],
      },
    ],
  },
};

// ==================== UNIT COMPOSITION PREFERENCES ====================

/**
 * Preferred army composition by difficulty and faction.
 * Values are relative weights (higher = more of this unit).
 */
export interface UnitCompositionWeights {
  [unitId: string]: number;
}

export const FACTION_UNIT_COMPOSITIONS: Record<
  string,
  Record<AIDifficulty, UnitCompositionWeights>
> = {
  dominion: {
    easy: {
      trooper: 1.0,
      breacher: 0.3,
    },
    medium: {
      trooper: 1.0,
      breacher: 0.5,
      vanguard: 0.3,
      scorcher: 0.2,
    },
    hard: {
      trooper: 0.8,
      breacher: 0.7,
      vanguard: 0.4,
      scorcher: 0.3,
      devastator: 0.5,
      valkyrie: 0.3,
    },
    very_hard: {
      trooper: 0.6,
      breacher: 0.8,
      vanguard: 0.5,
      operative: 0.3,
      scorcher: 0.4,
      devastator: 0.7,
      colossus: 0.4,
      valkyrie: 0.5,
      specter: 0.4,
    },
    insane: {
      trooper: 0.5,
      breacher: 0.9,
      vanguard: 0.6,
      operative: 0.5,
      scorcher: 0.5,
      devastator: 0.8,
      colossus: 0.6,
      valkyrie: 0.6,
      specter: 0.5,
      dreadnought: 0.4,
    },
  },
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get build orders for a faction and difficulty.
 */
export function getBuildOrders(faction: string, difficulty: AIDifficulty): BuildOrder[] {
  return FACTION_BUILD_ORDERS[faction]?.[difficulty] ?? [];
}

/**
 * Get a random build order for a faction and difficulty.
 */
export function getRandomBuildOrder(
  faction: string,
  difficulty: AIDifficulty,
  random: { next: () => number }
): BuildOrder | null {
  const orders = getBuildOrders(faction, difficulty);
  if (orders.length === 0) return null;
  const index = Math.floor(random.next() * orders.length);
  return orders[index];
}

/**
 * Get unit composition weights for a faction and difficulty.
 */
export function getUnitComposition(
  faction: string,
  difficulty: AIDifficulty
): UnitCompositionWeights {
  return FACTION_UNIT_COMPOSITIONS[faction]?.[difficulty] ?? {};
}

/**
 * Select a unit to build based on composition weights.
 */
export function selectUnitToBuild(
  faction: string,
  difficulty: AIDifficulty,
  availableUnits: string[],
  random: { next: () => number }
): string | null {
  const weights = getUnitComposition(faction, difficulty);

  // Filter to only available units
  const available = availableUnits.filter((u) => weights[u] !== undefined);
  if (available.length === 0) return availableUnits[0] ?? null;

  // Weighted random selection
  const totalWeight = available.reduce((sum, u) => sum + (weights[u] ?? 0), 0);
  if (totalWeight === 0) return available[0];

  let roll = random.next() * totalWeight;
  for (const unit of available) {
    roll -= weights[unit] ?? 0;
    if (roll <= 0) return unit;
  }

  return available[available.length - 1];
}

/**
 * Get all registered faction IDs that have build orders.
 */
export function getFactionsWithBuildOrders(): string[] {
  return Object.keys(FACTION_BUILD_ORDERS);
}

/**
 * Validate that a build order references valid units/buildings.
 * Useful for development/testing.
 */
export function validateBuildOrder(
  buildOrder: BuildOrder,
  validUnitIds: Set<string>,
  validBuildingIds: Set<string>,
  validResearchIds: Set<string>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const step of buildOrder.steps) {
    switch (step.type) {
      case 'unit':
        if (!validUnitIds.has(step.id)) {
          errors.push(`Unknown unit: ${step.id}`);
        }
        break;
      case 'building':
        if (!validBuildingIds.has(step.id)) {
          errors.push(`Unknown building: ${step.id}`);
        }
        break;
      case 'research':
        if (!validResearchIds.has(step.id)) {
          errors.push(`Unknown research: ${step.id}`);
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

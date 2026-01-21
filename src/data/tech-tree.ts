/**
 * Tech Tree Configuration
 * Dynamically builds tech tree categories from research definitions
 */

import { RESEARCH_DEFINITIONS, ResearchDefinition, UpgradeEffect, BUILDING_RESEARCH_MAP } from './research/dominion';

// Re-export for convenience
export { BUILDING_RESEARCH_MAP };

// Human-readable building names
export const BUILDING_DISPLAY_NAMES: Record<string, string> = {
  tech_center: 'Tech Center',
  arsenal: 'Arsenal',
  power_core: 'Power Core',
  infantry_bay_research_module: 'Infantry Bay + Research Module',
  forge_research_module: 'Forge + Research Module',
  hangar_research_module: 'Hangar + Research Module',
  ops_center: 'Ops Center',
};

// Category groupings for UI organization
export interface TechCategory {
  id: string;
  name: string;
  description: string;
  buildingId: string;
  buildingName: string;
  upgrades: ResearchDefinition[];
  upgradeChains: UpgradeChain[];
}

export interface UpgradeChain {
  id: string;
  name: string;
  levels: ResearchDefinition[];
  effectType: UpgradeEffect['type'];
}

/**
 * Get the complete upgrade chain starting from a level 1 upgrade
 */
function buildUpgradeChain(startId: string): ResearchDefinition[] {
  const chain: ResearchDefinition[] = [];
  let currentId: string | undefined = startId;

  while (currentId) {
    const upgrade: ResearchDefinition | undefined = RESEARCH_DEFINITIONS[currentId];
    if (!upgrade) break;
    chain.push(upgrade);
    currentId = upgrade.nextLevel;
  }

  return chain;
}

/**
 * Get short name for an upgrade (remove "Level X" suffix)
 */
function getUpgradeShortName(name: string): string {
  return name.replace(/ Level \d+$/, '');
}

/**
 * Build all tech categories dynamically from data
 */
export function buildTechCategories(): TechCategory[] {
  const categories: TechCategory[] = [];

  for (const [buildingId, researchIds] of Object.entries(BUILDING_RESEARCH_MAP)) {
    const upgrades: ResearchDefinition[] = [];
    const chains: UpgradeChain[] = [];
    const processedChainStarts = new Set<string>();

    for (const researchId of researchIds) {
      const research = RESEARCH_DEFINITIONS[researchId];
      if (!research) continue;

      upgrades.push(research);

      // Build upgrade chains from level 1 upgrades
      if (research.level === 1 && !processedChainStarts.has(researchId)) {
        processedChainStarts.add(researchId);
        const chainLevels = buildUpgradeChain(researchId);
        if (chainLevels.length > 0) {
          chains.push({
            id: researchId.replace('_1', ''),
            name: getUpgradeShortName(chainLevels[0].name),
            levels: chainLevels,
            effectType: chainLevels[0].effects[0]?.type || 'damage_bonus',
          });
        }
      }

      // Also add standalone upgrades (no level) as single-item chains
      if (!research.level && research.effects.length > 0) {
        chains.push({
          id: research.id,
          name: research.name,
          levels: [research],
          effectType: research.effects[0].type,
        });
      }
    }

    categories.push({
      id: buildingId,
      name: getCategoryName(buildingId),
      description: getCategoryDescription(buildingId),
      buildingId,
      buildingName: BUILDING_DISPLAY_NAMES[buildingId] || buildingId,
      upgrades,
      upgradeChains: chains,
    });
  }

  return categories;
}

function getCategoryName(buildingId: string): string {
  const names: Record<string, string> = {
    tech_center: 'Infantry Upgrades',
    arsenal: 'Vehicle & Ship Upgrades',
    power_core: 'Capital Ship Tech',
    infantry_bay_research_module: 'Infantry Abilities',
    forge_research_module: 'Vehicle Abilities',
    hangar_research_module: 'Air Abilities',
    ops_center: 'Covert Operations',
  };
  return names[buildingId] || 'Research';
}

function getCategoryDescription(buildingId: string): string {
  const descriptions: Record<string, string> = {
    tech_center: 'Upgrade infantry weapons and armor',
    arsenal: 'Upgrade vehicle and ship combat systems',
    power_core: 'Unlock Dreadnought advanced weapons',
    infantry_bay_research_module: 'Unlock abilities for infantry units',
    forge_research_module: 'Unlock abilities for vehicle units',
    hangar_research_module: 'Unlock abilities for air units',
    ops_center: 'Unlock stealth and special ops abilities',
  };
  return descriptions[buildingId] || '';
}

/**
 * Get human-readable effect description
 */
export function formatEffect(effect: UpgradeEffect): string {
  const valueStr = effect.value >= 1 ? `+${effect.value}` : `+${Math.round(effect.value * 100)}%`;

  const typeLabels: Record<UpgradeEffect['type'], string> = {
    damage_bonus: 'Damage',
    armor_bonus: 'Armor',
    attack_speed: 'Attack Speed',
    ability_unlock: 'Ability',
    range_bonus: 'Range',
    health_bonus: 'Health',
    speed_bonus: 'Speed',
  };

  const typeLabel = typeLabels[effect.type] || effect.type;

  if (effect.type === 'ability_unlock') {
    return 'Unlocks ability';
  }

  let targetStr = '';
  if (effect.targets && effect.targets.length > 0) {
    targetStr = ` (${effect.targets.map(t => t.replace('_', ' ')).join(', ')})`;
  } else if (effect.unitTypes && effect.unitTypes.length > 0) {
    targetStr = ` (${effect.unitTypes.join(', ')})`;
  }

  return `${valueStr} ${typeLabel}${targetStr}`;
}

/**
 * Get icon for an effect type
 */
export function getEffectIcon(effectType: UpgradeEffect['type']): string {
  const icons: Record<UpgradeEffect['type'], string> = {
    damage_bonus: '⚔️',
    armor_bonus: '🛡️',
    attack_speed: '⚡',
    ability_unlock: '✨',
    range_bonus: '🎯',
    health_bonus: '❤️',
    speed_bonus: '💨',
  };
  return icons[effectType] || '◆';
}

/**
 * Check if all requirements for a research are met
 */
export function checkRequirements(
  researchId: string,
  hasResearch: (playerId: string, upgradeId: string) => boolean,
  playerId: string
): { met: boolean; missing: string[] } {
  const research = RESEARCH_DEFINITIONS[researchId];
  if (!research || !research.requirements) {
    return { met: true, missing: [] };
  }

  const missing: string[] = [];
  for (const req of research.requirements) {
    // Check if it's a research requirement
    if (RESEARCH_DEFINITIONS[req]) {
      if (!hasResearch(playerId, req)) {
        missing.push(RESEARCH_DEFINITIONS[req].name);
      }
    }
    // Building requirements are checked separately in-game
  }

  return { met: missing.length === 0, missing };
}

// Pre-built categories (can be imported directly)
export const TECH_CATEGORIES = buildTechCategories();

export type UpgradeEffect = {
  type: 'damage_bonus' | 'armor_bonus' | 'attack_speed' | 'ability_unlock' | 'range_bonus' | 'health_bonus' | 'speed_bonus';
  value: number;
  targets?: string[]; // unit IDs this affects, empty = all
  unitTypes?: ('infantry' | 'vehicle' | 'ship')[]; // unit type categories
};

export interface ResearchDefinition {
  id: string;
  name: string;
  description: string;
  faction: string;
  mineralCost: number;
  vespeneCost: number;
  researchTime: number; // seconds
  effects: UpgradeEffect[];
  requirements?: string[]; // building IDs or upgrade IDs required
  level?: number; // 1, 2, 3 for tiered upgrades
  nextLevel?: string; // upgrade ID for next level
  icon?: string;
}

// Unit type mappings
export const UNIT_TYPES: Record<string, 'infantry' | 'vehicle' | 'ship'> = {
  constructor: 'infantry',
  trooper: 'infantry',
  breacher: 'infantry',
  vanguard: 'infantry',
  operative: 'infantry',
  scorcher: 'vehicle',
  devastator: 'vehicle',
  colossus: 'vehicle',
  lifter: 'ship',
  valkyrie: 'ship',
  specter: 'ship',
  dreadnought: 'ship',
};

export const RESEARCH_DEFINITIONS: Record<string, ResearchDefinition> = {
  // Infantry Weapons (Engineering Bay)
  infantry_weapons_1: {
    id: 'infantry_weapons_1',
    name: 'Infantry Weapons Level 1',
    description: 'Increases the attack damage of infantry units.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 114,
    level: 1,
    nextLevel: 'infantry_weapons_2',
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['infantry'],
      },
    ],
  },

  infantry_weapons_2: {
    id: 'infantry_weapons_2',
    name: 'Infantry Weapons Level 2',
    description: 'Further increases the attack damage of infantry units.',
    faction: 'dominion',
    mineralCost: 175,
    vespeneCost: 175,
    researchTime: 136,
    level: 2,
    nextLevel: 'infantry_weapons_3',
    requirements: ['infantry_weapons_1', 'arsenal'],
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['infantry'],
      },
    ],
  },

  infantry_weapons_3: {
    id: 'infantry_weapons_3',
    name: 'Infantry Weapons Level 3',
    description: 'Maximizes the attack damage of infantry units.',
    faction: 'dominion',
    mineralCost: 250,
    vespeneCost: 250,
    researchTime: 157,
    level: 3,
    requirements: ['infantry_weapons_2', 'arsenal'],
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['infantry'],
      },
    ],
  },

  // Infantry Armor (Engineering Bay)
  infantry_armor_1: {
    id: 'infantry_armor_1',
    name: 'Infantry Armor Level 1',
    description: 'Increases the armor of infantry units.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 114,
    level: 1,
    nextLevel: 'infantry_armor_2',
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['infantry'],
      },
    ],
  },

  infantry_armor_2: {
    id: 'infantry_armor_2',
    name: 'Infantry Armor Level 2',
    description: 'Further increases the armor of infantry units.',
    faction: 'dominion',
    mineralCost: 175,
    vespeneCost: 175,
    researchTime: 136,
    level: 2,
    nextLevel: 'infantry_armor_3',
    requirements: ['infantry_armor_1', 'arsenal'],
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['infantry'],
      },
    ],
  },

  infantry_armor_3: {
    id: 'infantry_armor_3',
    name: 'Infantry Armor Level 3',
    description: 'Maximizes the armor of infantry units.',
    faction: 'dominion',
    mineralCost: 250,
    vespeneCost: 250,
    researchTime: 157,
    level: 3,
    requirements: ['infantry_armor_2', 'arsenal'],
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['infantry'],
      },
    ],
  },

  // Vehicle Weapons (Armory)
  vehicle_weapons_1: {
    id: 'vehicle_weapons_1',
    name: 'Vehicle Weapons Level 1',
    description: 'Increases the attack damage of vehicle units.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 114,
    level: 1,
    nextLevel: 'vehicle_weapons_2',
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['vehicle'],
      },
    ],
  },

  vehicle_weapons_2: {
    id: 'vehicle_weapons_2',
    name: 'Vehicle Weapons Level 2',
    description: 'Further increases the attack damage of vehicle units.',
    faction: 'dominion',
    mineralCost: 175,
    vespeneCost: 175,
    researchTime: 136,
    level: 2,
    nextLevel: 'vehicle_weapons_3',
    requirements: ['vehicle_weapons_1'],
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['vehicle'],
      },
    ],
  },

  vehicle_weapons_3: {
    id: 'vehicle_weapons_3',
    name: 'Vehicle Weapons Level 3',
    description: 'Maximizes the attack damage of vehicle units.',
    faction: 'dominion',
    mineralCost: 250,
    vespeneCost: 250,
    researchTime: 157,
    level: 3,
    requirements: ['vehicle_weapons_2'],
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['vehicle'],
      },
    ],
  },

  // Vehicle Armor (Armory)
  vehicle_armor_1: {
    id: 'vehicle_armor_1',
    name: 'Vehicle Armor Level 1',
    description: 'Increases the armor of vehicle units.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 114,
    level: 1,
    nextLevel: 'vehicle_armor_2',
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['vehicle'],
      },
    ],
  },

  vehicle_armor_2: {
    id: 'vehicle_armor_2',
    name: 'Vehicle Armor Level 2',
    description: 'Further increases the armor of vehicle units.',
    faction: 'dominion',
    mineralCost: 175,
    vespeneCost: 175,
    researchTime: 136,
    level: 2,
    nextLevel: 'vehicle_armor_3',
    requirements: ['vehicle_armor_1'],
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['vehicle'],
      },
    ],
  },

  vehicle_armor_3: {
    id: 'vehicle_armor_3',
    name: 'Vehicle Armor Level 3',
    description: 'Maximizes the armor of vehicle units.',
    faction: 'dominion',
    mineralCost: 250,
    vespeneCost: 250,
    researchTime: 157,
    level: 3,
    requirements: ['vehicle_armor_2'],
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['vehicle'],
      },
    ],
  },

  // Ship Weapons (Armory)
  ship_weapons_1: {
    id: 'ship_weapons_1',
    name: 'Ship Weapons Level 1',
    description: 'Increases the attack damage of air units.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 114,
    level: 1,
    nextLevel: 'ship_weapons_2',
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['ship'],
      },
    ],
  },

  ship_weapons_2: {
    id: 'ship_weapons_2',
    name: 'Ship Weapons Level 2',
    description: 'Further increases the attack damage of air units.',
    faction: 'dominion',
    mineralCost: 175,
    vespeneCost: 175,
    researchTime: 136,
    level: 2,
    nextLevel: 'ship_weapons_3',
    requirements: ['ship_weapons_1'],
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['ship'],
      },
    ],
  },

  ship_weapons_3: {
    id: 'ship_weapons_3',
    name: 'Ship Weapons Level 3',
    description: 'Maximizes the attack damage of air units.',
    faction: 'dominion',
    mineralCost: 250,
    vespeneCost: 250,
    researchTime: 157,
    level: 3,
    requirements: ['ship_weapons_2'],
    effects: [
      {
        type: 'damage_bonus',
        value: 1,
        unitTypes: ['ship'],
      },
    ],
  },

  // Ship Armor (Armory)
  ship_armor_1: {
    id: 'ship_armor_1',
    name: 'Ship Armor Level 1',
    description: 'Increases the armor of air units.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 114,
    level: 1,
    nextLevel: 'ship_armor_2',
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['ship'],
      },
    ],
  },

  ship_armor_2: {
    id: 'ship_armor_2',
    name: 'Ship Armor Level 2',
    description: 'Further increases the armor of air units.',
    faction: 'dominion',
    mineralCost: 175,
    vespeneCost: 175,
    researchTime: 136,
    level: 2,
    nextLevel: 'ship_armor_3',
    requirements: ['ship_armor_1'],
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['ship'],
      },
    ],
  },

  ship_armor_3: {
    id: 'ship_armor_3',
    name: 'Ship Armor Level 3',
    description: 'Maximizes the armor of air units.',
    faction: 'dominion',
    mineralCost: 250,
    vespeneCost: 250,
    researchTime: 157,
    level: 3,
    requirements: ['ship_armor_2'],
    effects: [
      {
        type: 'armor_bonus',
        value: 1,
        unitTypes: ['ship'],
      },
    ],
  },

  // Special Upgrades (Power Core)
  nova_cannon: {
    id: 'nova_cannon',
    name: 'Nova Cannon',
    description: 'Unlocks the devastating Nova Cannon ability for Dreadnoughts.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 150,
    researchTime: 100,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['dreadnought'],
      },
    ],
  },

  dreadnought_weapon_refit: {
    id: 'dreadnought_weapon_refit',
    name: 'Weapon Refit',
    description: 'Increases Dreadnought attack speed by 25%.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 150,
    researchTime: 100,
    effects: [
      {
        type: 'attack_speed',
        value: 0.25,
        targets: ['dreadnought'],
      },
    ],
  },

  // Combat Stim (Research Module)
  combat_stim: {
    id: 'combat_stim',
    name: 'Combat Stim',
    description: 'Unlocks the Combat Stim ability for Troopers and Breachers.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 100,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['trooper', 'breacher'],
      },
    ],
  },

  // Combat Shield (Research Module)
  combat_shield: {
    id: 'combat_shield',
    name: 'Combat Shield',
    description: 'Increases Trooper health by 10.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'health_bonus',
        value: 10,
        targets: ['trooper'],
      },
    ],
  },

  // Concussive Shells (Research Module)
  concussive_shells: {
    id: 'concussive_shells',
    name: 'Concussive Shells',
    description: 'Breacher attacks slow enemy movement speed.',
    faction: 'dominion',
    mineralCost: 50,
    vespeneCost: 50,
    researchTime: 43,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['breacher'],
      },
    ],
  },

  // Bombardment Systems (Research Module - Forge)
  bombardment_systems: {
    id: 'bombardment_systems',
    name: 'Bombardment Systems',
    description: 'Enables Devastators to transform into Bombardment Mode.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['devastator'],
      },
    ],
  },

  // Drilling Claws (Research Module - Forge)
  drilling_claws: {
    id: 'drilling_claws',
    name: 'Drilling Claws',
    description: 'Scorchers transform into Inferno mode faster.',
    faction: 'dominion',
    mineralCost: 75,
    vespeneCost: 75,
    researchTime: 79,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['scorcher'],
      },
    ],
  },

  // Cloaking Field (Research Module - Hangar)
  cloaking_field: {
    id: 'cloaking_field',
    name: 'Cloaking Field',
    description: 'Enables Specters to cloak.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['specter'],
      },
    ],
  },

  // Medical Reactor (Research Module - Hangar)
  medical_reactor: {
    id: 'medical_reactor',
    name: 'Medical Reactor',
    description: 'Increases Lifter energy regeneration by 100%.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 57,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['lifter'],
      },
    ],
  },

  // Auto Tracking (Tech Center)
  auto_tracking: {
    id: 'auto_tracking',
    name: 'Auto Tracking',
    description: 'Increases the attack range of structures by 1.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 57,
    effects: [
      {
        type: 'range_bonus',
        value: 1,
        targets: ['defense_turret', 'garrison'],
      },
    ],
  },

  // Building Armor (Tech Center)
  building_armor: {
    id: 'building_armor',
    name: 'Reinforced Plating',
    description: 'Increases the armor of all structures by 2.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 150,
    researchTime: 100,
    effects: [
      {
        type: 'armor_bonus',
        value: 2,
        targets: [], // all buildings
      },
    ],
  },

  // Thermal Igniter (Research Module - Forge)
  thermal_igniter: {
    id: 'thermal_igniter',
    name: 'Thermal Igniter',
    description: 'Increases Scorcher attack damage by 5.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'damage_bonus',
        value: 5,
        targets: ['scorcher'],
      },
    ],
  },

  // Stealth Systems (Ops Center)
  stealth_systems: {
    id: 'stealth_systems',
    name: 'Stealth Systems',
    description: 'Enables Operatives to cloak.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 150,
    researchTime: 100,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['operative'],
      },
    ],
  },

  // Enhanced Reactor (Ops Center)
  enhanced_reactor: {
    id: 'enhanced_reactor',
    name: 'Enhanced Reactor',
    description: 'Increases Operative starting energy by 25.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['operative'],
      },
    ],
  },
};

export const DOMINION_RESEARCH = Object.values(RESEARCH_DEFINITIONS);

// Helper function to get all available research for a building
export function getAvailableResearch(buildingId: string): ResearchDefinition[] {
  const building = {
    tech_center: ['infantry_weapons_1', 'infantry_armor_1', 'auto_tracking', 'building_armor'],
    arsenal: ['vehicle_weapons_1', 'vehicle_armor_1', 'ship_weapons_1', 'ship_armor_1'],
    power_core: ['nova_cannon', 'dreadnought_weapon_refit'],
    infantry_bay_research_module: ['combat_stim', 'combat_shield', 'concussive_shells'],
    forge_research_module: ['bombardment_systems', 'drilling_claws', 'thermal_igniter'],
    hangar_research_module: ['cloaking_field', 'medical_reactor'],
    ops_center: ['stealth_systems', 'enhanced_reactor'],
  }[buildingId];

  if (!building) return [];

  return building
    .map(id => RESEARCH_DEFINITIONS[id])
    .filter((r): r is ResearchDefinition => r !== undefined);
}

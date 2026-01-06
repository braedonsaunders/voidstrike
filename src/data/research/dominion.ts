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
  scv: 'infantry',
  marine: 'infantry',
  marauder: 'infantry',
  reaper: 'infantry',
  ghost: 'infantry',
  hellion: 'vehicle',
  siege_tank: 'vehicle',
  thor: 'vehicle',
  medivac: 'ship',
  viking: 'ship',
  banshee: 'ship',
  battlecruiser: 'ship',
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
    requirements: ['infantry_weapons_1', 'armory'],
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
    requirements: ['infantry_weapons_2', 'armory'],
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
    requirements: ['infantry_armor_1', 'armory'],
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
    requirements: ['infantry_armor_2', 'armory'],
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

  // Special Upgrades (Fusion Core)
  yamato_cannon: {
    id: 'yamato_cannon',
    name: 'Yamato Cannon',
    description: 'Unlocks the devastating Yamato Cannon ability for Battlecruisers.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 150,
    researchTime: 100,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['battlecruiser'],
      },
    ],
  },

  battlecruiser_weapon_refit: {
    id: 'battlecruiser_weapon_refit',
    name: 'Weapon Refit',
    description: 'Increases Battlecruiser attack speed by 25%.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 150,
    researchTime: 100,
    effects: [
      {
        type: 'attack_speed',
        value: 0.25,
        targets: ['battlecruiser'],
      },
    ],
  },

  // Stim Pack (Tech Lab)
  stim_pack: {
    id: 'stim_pack',
    name: 'Stimpack',
    description: 'Unlocks the Stimpack ability for Marines and Marauders.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 100,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['marine', 'marauder'],
      },
    ],
  },

  // Combat Shield (Tech Lab)
  combat_shield: {
    id: 'combat_shield',
    name: 'Combat Shield',
    description: 'Increases Marine health by 10.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'health_bonus',
        value: 10,
        targets: ['marine'],
      },
    ],
  },

  // Concussive Shells (Tech Lab)
  concussive_shells: {
    id: 'concussive_shells',
    name: 'Concussive Shells',
    description: 'Marauder attacks slow enemy movement speed.',
    faction: 'dominion',
    mineralCost: 50,
    vespeneCost: 50,
    researchTime: 43,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['marauder'],
      },
    ],
  },

  // Siege Tech (Tech Lab - Factory)
  siege_tech: {
    id: 'siege_tech',
    name: 'Siege Tech',
    description: 'Enables Siege Tanks to transform into Siege Mode.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['siege_tank'],
      },
    ],
  },

  // Drilling Claws (Tech Lab - Factory)
  drilling_claws: {
    id: 'drilling_claws',
    name: 'Drilling Claws',
    description: 'Hellions transform into Hellbats faster.',
    faction: 'dominion',
    mineralCost: 75,
    vespeneCost: 75,
    researchTime: 79,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['hellion'],
      },
    ],
  },

  // Cloaking Field (Tech Lab - Starport)
  cloaking_field: {
    id: 'cloaking_field',
    name: 'Cloaking Field',
    description: 'Enables Banshees to cloak.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 79,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['banshee'],
      },
    ],
  },

  // Caduceus Reactor (Tech Lab - Starport)
  caduceus_reactor: {
    id: 'caduceus_reactor',
    name: 'Caduceus Reactor',
    description: 'Increases Medivac energy regeneration by 100%.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 57,
    effects: [
      {
        type: 'ability_unlock',
        value: 1,
        targets: ['medivac'],
      },
    ],
  },

  // Hi-Sec Auto Tracking (Engineering Bay)
  hi_sec_auto_tracking: {
    id: 'hi_sec_auto_tracking',
    name: 'Hi-Sec Auto Tracking',
    description: 'Increases the attack range of structures by 1.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 57,
    effects: [
      {
        type: 'range_bonus',
        value: 1,
        targets: ['missile_turret', 'bunker'],
      },
    ],
  },

  // Building Armor (Engineering Bay)
  building_armor: {
    id: 'building_armor',
    name: 'Neosteel Armor',
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
};

export const DOMINION_RESEARCH = Object.values(RESEARCH_DEFINITIONS);

// Helper function to get all available research for a building
export function getAvailableResearch(buildingId: string): ResearchDefinition[] {
  const building = {
    engineering_bay: ['infantry_weapons_1', 'infantry_armor_1', 'hi_sec_auto_tracking', 'building_armor'],
    armory: ['vehicle_weapons_1', 'vehicle_armor_1', 'ship_weapons_1', 'ship_armor_1'],
    fusion_core: ['yamato_cannon', 'battlecruiser_weapon_refit'],
    barracks_tech_lab: ['stim_pack', 'combat_shield', 'concussive_shells'],
    factory_tech_lab: ['siege_tech', 'drilling_claws'],
    starport_tech_lab: ['cloaking_field', 'caduceus_reactor'],
  }[buildingId];

  if (!building) return [];

  return building
    .map(id => RESEARCH_DEFINITIONS[id])
    .filter((r): r is ResearchDefinition => r !== undefined);
}

/**
 * Basic structures (no tech requirements)
 */
export const BASIC_BUILDINGS = [
  'headquarters',
  'supply_cache',
  'extractor',
  'infantry_bay',
  'tech_center',
  'garrison',
  'defense_turret',
];

/**
 * Advanced structures (tech requirements)
 */
export const ADVANCED_BUILDINGS = [
  'forge',
  'arsenal',
  'hangar',
  'power_core',
  'ops_center',
  'radar_array',
];

/**
 * Wall buildings
 */
export const WALL_BUILDINGS = ['wall_segment', 'wall_gate'];

/**
 * Research available at each building type.
 */
export const BUILDING_RESEARCH_MAP: Record<string, string[]> = {
  tech_center: ['infantry_weapons_1', 'infantry_armor_1'],
  arsenal: ['vehicle_weapons_1', 'vehicle_armor_1'],
  infantry_bay: ['combat_stim', 'combat_shield'],
  forge: ['bombardment_systems'],
  hangar: ['cloaking_field'],
};

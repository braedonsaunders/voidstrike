// Shared icon mappings for game UI components
// Use this file for consistent icons across SelectionPanel, CommandCard, and ProductionQueuePanel

export const UNIT_ICONS: Record<string, string> = {
  // Workers
  fabricator: '🔧',
  scv: '⛏️',

  // Infantry
  trooper: '🎖️',
  marine: '🎖️',
  breacher: '💪',
  marauder: '💪',
  vanguard: '💀',
  reaper: '💀',
  operative: '👻',
  ghost: '👻',

  // Vehicles
  scorcher: '🔥',
  hellion: '🔥',
  devastator: '🎯',
  siege_tank: '🛡️',
  colossus: '⚡',
  thor: '⚡',

  // Air
  lifter: '✚',
  medivac: '➕',
  valkyrie: '✈️',
  viking: '✈️',
  specter: '🦇',
  banshee: '🦇',
  dreadnought: '🚀',
  battlecruiser: '🚀',
  overseer: '🦅',
};

export const BUILDING_ICONS: Record<string, string> = {
  headquarters: '🏛️',
  command_center: '🏛️',
  orbital_station: '🛰️',
  orbital_command: '🛰️',
  bastion: '🏰',
  planetary_fortress: '🏰',
  supply_cache: '📦',
  supply_depot: '📦',
  extractor: '⛽',
  refinery: '⛽',
  infantry_bay: '🏠',
  barracks: '🏠',
  tech_center: '🔬',
  engineering_bay: '🔬',
  garrison: '🏰',
  bunker: '🏰',
  forge: '🏭',
  factory: '🏭',
  arsenal: '⚙️',
  armory: '⚙️',
  hangar: '🛫',
  starport: '🛫',
  power_core: '⚛️',
  fusion_core: '⚛️',
  ops_center: '🎓',
  ghost_academy: '🎓',
  radar_array: '📡',
  sensor_tower: '📡',
  defense_turret: '🗼',
  missile_turret: '🗼',
  research_module: '🔬',
  tech_lab: '🔬',
};

export const COMMAND_ICONS: Record<string, string> = {
  // Basic commands
  move: '➤',
  stop: '■',
  hold: '⛊',
  attack: '⚔️',
  patrol: '↻',
  gather: '⛏️',
  repair: '🔧',
  rally: '⚑',
  build: '🔨',
  build_basic: '🏗️',
  build_advanced: '🏭',
  cancel: '✕',
  back: '◀',

  // Upgrades
  stim: '💉',
  combat: '🛡️',
  infantry: '⚔️',
  vehicle: '💥',
  ship: '🚀',
  siege: '🎯',
  cloak: '👁️',

  // Abilities
  mule: '🔧',
  scanner_sweep: '📡',
  supply_drop: '📦',
  scanner: '📡',
};

export function getUnitIcon(unitId: string): string {
  return UNIT_ICONS[unitId] ?? '❓';
}

export function getBuildingIcon(buildingId: string): string {
  return BUILDING_ICONS[buildingId] ?? '🏢';
}

export function getCommandIcon(id: string): string {
  const lc = id.toLowerCase();

  // Check exact matches first
  if (COMMAND_ICONS[lc]) return COMMAND_ICONS[lc];
  if (UNIT_ICONS[lc]) return UNIT_ICONS[lc];
  if (BUILDING_ICONS[lc]) return BUILDING_ICONS[lc];

  // Check partial matches
  for (const [key, icon] of Object.entries(COMMAND_ICONS)) {
    if (lc.includes(key)) return icon;
  }
  for (const [key, icon] of Object.entries(UNIT_ICONS)) {
    if (lc.includes(key)) return icon;
  }
  for (const [key, icon] of Object.entries(BUILDING_ICONS)) {
    if (lc.includes(key)) return icon;
  }

  return '◆';
}

/**
 * Icon mappings for commands, units, and buildings.
 */
export const COMMAND_ICONS: Record<string, string> = {
  // Basic commands
  move: '➤',
  stop: '■',
  hold: '⛊',
  attack: '⚔',
  patrol: '↻',
  gather: '⛏',
  repair: '🔧',
  rally: '⚑',
  build: '🔨',
  build_basic: '🏗',
  build_advanced: '🏭',
  cancel: '✕',
  demolish: '🗑',
  back: '◀',
  liftoff: '🚀',
  land: '🛬',
  // Units
  fabricator: '🔧',
  trooper: '🎖',
  breacher: '💪',
  vanguard: '💀',
  operative: '👻',
  scorcher: '🔥',
  devastator: '🎯',
  colossus: '⚡',
  lifter: '✚',
  valkyrie: '✈',
  specter: '🦇',
  dreadnought: '🚀',
  overseer: '🦅',
  // Buildings
  headquarters: '🏛',
  orbital_station: '🛰',
  bastion: '🏰',
  supply_cache: '📦',
  extractor: '⛽',
  infantry_bay: '🏠',
  tech_center: '🔬',
  garrison: '🏰',
  forge: '🏭',
  arsenal: '⚙',
  hangar: '🛫',
  power_core: '⚛',
  ops_center: '🎓',
  radar_array: '📡',
  defense_turret: '🗼',
  // Walls
  wall: '🧱',
  wall_segment: '🧱',
  wall_gate: '🚪',
  gate: '🚪',
  // Gate commands
  open: '📖',
  close: '📕',
  lock: '🔒',
  unlock: '🔓',
  auto: '🔄',
  // Upgrades
  stim: '💉',
  combat: '🛡',
  infantry: '⚔',
  vehicle: '💥',
  ship: '🚀',
  siege: '🎯',
  cloak: '👁',
  // Abilities
  mule: '🔧',
  scanner_sweep: '📡',
  supply_drop: '📦',
  scanner: '📡',
  power_cannon: '⚡',
  warp_jump: '🌀',
  // Transform modes
  transform_fighter: '✈',
  transform_assault: '⬇',
  fighter: '✈',
  assault: '⬇',
  default: '◆',
};

/**
 * Get icon for a command/unit/building ID.
 * Falls back to partial matching, then default icon.
 */
export function getCommandIcon(id: string): string {
  const lc = id.toLowerCase();
  if (COMMAND_ICONS[lc]) return COMMAND_ICONS[lc];
  for (const [key, icon] of Object.entries(COMMAND_ICONS)) {
    if (lc.includes(key)) return icon;
  }
  return COMMAND_ICONS.default;
}

/**
 * Get attack type indicator text for unit tooltips.
 */
export function getAttackTypeText(unitDef: {
  attackDamage?: number;
  canAttackGround?: boolean;
  canAttackAir?: boolean;
}): string {
  if (!unitDef) return '';

  const canAttackGround = unitDef.canAttackGround ?? ((unitDef.attackDamage ?? 0) > 0);
  const canAttackAir = unitDef.canAttackAir ?? false;

  if (!canAttackGround && !canAttackAir) {
    return '⊘ No attack';
  } else if (canAttackGround && canAttackAir) {
    return '⬡ Attacks: Ground & Air';
  } else if (canAttackGround) {
    return '⬢ Attacks: Ground only';
  } else {
    return '✈ Attacks: Air only';
  }
}

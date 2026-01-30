/**
 * Ability System - Data-Driven Ability Definitions
 *
 * This file defines all unit and building abilities in a data-driven way.
 * The ability system supports various targeting modes, effects, and cooldowns.
 *
 * Ability Types:
 * - instant: Immediate effect, no targeting (e.g., stim pack)
 * - targeted: Requires target selection (e.g., snipe)
 * - ground: Targets a ground location (e.g., nuke)
 * - passive: Always active, no activation (e.g., cloak detection)
 * - toggle: Can be turned on/off (e.g., cloak)
 * - autocast: Can be set to auto-use (e.g., heal)
 */

// ==================== ABILITY TYPES ====================

// AbilityActivationMode describes how an ability is activated (instant, targeted, etc.)
// This is distinct from AbilityTargetType in engine/components/Ability.ts which describes
// the targeting behavior (none, point, unit, ally, self)
export type AbilityActivationMode = 'instant' | 'targeted' | 'ground' | 'passive' | 'toggle' | 'autocast';
export type AbilityEffectType =
  | 'damage'
  | 'heal'
  | 'buff'
  | 'debuff'
  | 'spawn'
  | 'transform'
  | 'teleport'
  | 'cloak'
  | 'detect'
  | 'resource'
  | 'custom';

export interface AbilityEffect {
  type: AbilityEffectType;
  value?: number;
  duration?: number; // Seconds
  radius?: number; // AoE radius
  targetFilter?: AbilityTargetFilter;
  customHandler?: string; // Name of custom handler function
}

export interface AbilityTargetFilter {
  includeSelf?: boolean;
  includeAllies?: boolean;
  includeEnemies?: boolean;
  includeNeutral?: boolean;
  unitCategories?: string[]; // Filter by unit category
  requiresBiological?: boolean;
  requiresMechanical?: boolean;
  requiresGround?: boolean;
  requiresAir?: boolean;
}

// ==================== ABILITY DEFINITION ====================

// AbilityDataDefinition is for data layer definitions (game content)
// This is distinct from AbilityDefinition in engine/components/Ability.ts which is for ECS runtime
export interface AbilityDataDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;

  // Targeting
  targetType: AbilityActivationMode;
  range?: number; // Range for targeted abilities
  radius?: number; // Effect radius for AoE

  // Costs
  energyCost?: number;
  healthCost?: number;
  resourceCost?: { [resourceId: string]: number };

  // Timing
  cooldown?: number; // Seconds
  castTime?: number; // Seconds (0 = instant)
  duration?: number; // Seconds for buffs/toggles

  // Effects
  effects: AbilityEffect[];

  // Requirements
  requiresResearch?: string[]; // Research IDs required
  requiresBuilding?: string[]; // Building IDs required

  // Flags
  canAutocast?: boolean;
  interruptsMovement?: boolean;
  channeled?: boolean; // Ability is interrupted if unit moves/attacked

  // Audio/Visual
  soundEffect?: string;
  visualEffect?: string;
}

// ==================== ABILITY DEFINITIONS ====================

export const ABILITY_DEFINITIONS: Record<string, AbilityDataDefinition> = {
  // === INFANTRY ABILITIES ===

  stim_pack: {
    id: 'stim_pack',
    name: 'Stim Pack',
    description: 'Increases attack speed and movement speed at the cost of health.',
    targetType: 'instant',
    healthCost: 10,
    cooldown: 0, // Can use any time
    duration: 11,
    effects: [
      { type: 'buff', value: 1.5, duration: 11 }, // 50% speed boost
    ],
    requiresResearch: ['combat_stim'],
    interruptsMovement: false,
  },

  concussive_shells: {
    id: 'concussive_shells',
    name: 'Concussive Shells',
    description: 'Attacks slow enemy movement speed.',
    targetType: 'passive',
    effects: [
      { type: 'debuff', value: 0.5, duration: 2 }, // 50% slow for 2s
    ],
    requiresResearch: ['concussive_shells'],
  },

  snipe: {
    id: 'snipe',
    name: 'Snipe',
    description: 'Deals heavy damage to a biological target.',
    targetType: 'targeted',
    range: 10,
    energyCost: 50,
    cooldown: 1.43,
    effects: [
      {
        type: 'damage',
        value: 170,
        targetFilter: { requiresBiological: true, includeEnemies: true },
      },
    ],
    channeled: true,
    interruptsMovement: true,
  },

  emp_round: {
    id: 'emp_round',
    name: 'EMP Round',
    description: 'Drains energy and shields in an area.',
    targetType: 'ground',
    range: 10,
    radius: 1.5,
    energyCost: 75,
    cooldown: 0.71,
    effects: [
      { type: 'debuff', value: 100, radius: 1.5 }, // Drain 100 energy
    ],
    interruptsMovement: false,
  },

  cloak: {
    id: 'cloak',
    name: 'Cloak',
    description: 'Become invisible to enemies without detection.',
    targetType: 'toggle',
    energyCost: 1, // Per second
    effects: [
      { type: 'cloak' },
    ],
    requiresResearch: ['stealth_systems'],
    interruptsMovement: false,
  },

  nuke: {
    id: 'nuke',
    name: 'Nuclear Strike',
    description: 'Call down a devastating nuclear strike.',
    targetType: 'ground',
    range: 12,
    radius: 8,
    energyCost: 75,
    cooldown: 0,
    castTime: 14, // 14 second warning
    effects: [
      { type: 'damage', value: 300, radius: 8 },
    ],
    requiresResearch: ['nuke'],
    channeled: true,
    interruptsMovement: true,
    visualEffect: 'nuke_warning',
    soundEffect: 'nuke_launch',
  },

  jet_pack: {
    id: 'jet_pack',
    name: 'Jet Pack',
    description: 'Jump to a target location.',
    targetType: 'ground',
    range: 8,
    cooldown: 10,
    effects: [
      { type: 'teleport' },
    ],
    interruptsMovement: true,
  },

  grenade: {
    id: 'grenade',
    name: 'Grenade',
    description: 'Throw a grenade that deals splash damage.',
    targetType: 'ground',
    range: 6,
    radius: 2,
    cooldown: 8,
    effects: [
      { type: 'damage', value: 30, radius: 2 },
    ],
    interruptsMovement: false,
  },

  // === VEHICLE ABILITIES ===

  transform_inferno: {
    id: 'transform_inferno',
    name: 'Transform: Inferno',
    description: 'Transform into Inferno mode for increased close-range damage.',
    targetType: 'instant',
    cooldown: 2.25,
    effects: [
      { type: 'transform' },
    ],
    interruptsMovement: true,
  },

  bombardment_mode: {
    id: 'bombardment_mode',
    name: 'Siege Mode',
    description: 'Deploy into siege mode for long-range artillery.',
    targetType: 'instant',
    cooldown: 2,
    effects: [
      { type: 'transform' },
    ],
    requiresResearch: ['bombardment_systems'],
    interruptsMovement: true,
  },

  high_impact_payload: {
    id: 'high_impact_payload',
    name: 'High Impact Payload',
    description: 'Fire a devastating shot that deals massive damage.',
    targetType: 'targeted',
    range: 9,
    cooldown: 10,
    effects: [
      { type: 'damage', value: 100 },
    ],
    interruptsMovement: false,
  },

  // === SHIP ABILITIES ===

  transform_assault: {
    id: 'transform_assault',
    name: 'Transform: Assault',
    description: 'Land and transform into ground assault mode.',
    targetType: 'instant',
    cooldown: 2.25,
    effects: [
      { type: 'transform' },
    ],
    interruptsMovement: true,
  },

  power_cannon: {
    id: 'power_cannon',
    name: 'Power Cannon',
    description: 'Fire the main cannon for devastating damage.',
    targetType: 'targeted',
    range: 10,
    energyCost: 100,
    cooldown: 5,
    effects: [
      { type: 'damage', value: 200 },
    ],
    interruptsMovement: false,
  },

  warp_jump: {
    id: 'warp_jump',
    name: 'Warp Jump',
    description: 'Teleport to a visible location.',
    targetType: 'ground',
    range: 30,
    energyCost: 125,
    cooldown: 60,
    effects: [
      { type: 'teleport' },
    ],
    interruptsMovement: true,
  },

  // === SUPPORT ABILITIES ===

  heal: {
    id: 'heal',
    name: 'Heal',
    description: 'Restore health to a biological unit.',
    targetType: 'autocast',
    range: 4,
    energyCost: 1, // Per health point
    effects: [
      {
        type: 'heal',
        value: 12.6, // Per second
        targetFilter: { requiresBiological: true, includeAllies: true, includeSelf: false },
      },
    ],
    canAutocast: true,
    interruptsMovement: false,
  },

  load: {
    id: 'load',
    name: 'Load',
    description: 'Load units into the transport.',
    targetType: 'targeted',
    range: 5,
    effects: [
      { type: 'custom', customHandler: 'loadUnit' },
    ],
    interruptsMovement: false,
  },

  unload: {
    id: 'unload',
    name: 'Unload',
    description: 'Unload all units from the transport.',
    targetType: 'ground',
    range: 0,
    effects: [
      { type: 'custom', customHandler: 'unloadUnits' },
    ],
    interruptsMovement: true,
  },

  afterburners: {
    id: 'afterburners',
    name: 'Afterburners',
    description: 'Temporarily increase movement speed.',
    targetType: 'instant',
    cooldown: 20,
    duration: 5,
    effects: [
      { type: 'buff', value: 2.0, duration: 5 }, // Double speed
    ],
    interruptsMovement: false,
  },

  // === DETECTOR ABILITIES ===

  auto_turret: {
    id: 'auto_turret',
    name: 'Auto-Turret',
    description: 'Deploy an automated turret.',
    targetType: 'ground',
    range: 7,
    energyCost: 50,
    cooldown: 0,
    effects: [
      { type: 'spawn', value: 1 }, // Spawn turret entity
    ],
    interruptsMovement: false,
  },

  interference_matrix: {
    id: 'interference_matrix',
    name: 'Interference Matrix',
    description: 'Disable a mechanical unit.',
    targetType: 'targeted',
    range: 9,
    energyCost: 75,
    cooldown: 0,
    duration: 8,
    effects: [
      {
        type: 'debuff',
        duration: 8,
        targetFilter: { requiresMechanical: true, includeEnemies: true },
      },
    ],
    interruptsMovement: false,
  },

  anti_armor_missile: {
    id: 'anti_armor_missile',
    name: 'Anti-Armor Missile',
    description: 'Fire a missile that reduces target armor.',
    targetType: 'targeted',
    range: 10,
    energyCost: 75,
    cooldown: 0,
    duration: 21,
    effects: [
      { type: 'debuff', value: 3, duration: 21 }, // -3 armor
    ],
    interruptsMovement: false,
  },

  // === BUILDING ABILITIES ===

  sensor_sweep: {
    id: 'sensor_sweep',
    name: 'Sensor Sweep',
    description: 'Reveal an area of the map.',
    targetType: 'ground',
    range: 999, // Global
    radius: 12,
    energyCost: 50,
    cooldown: 0,
    duration: 12,
    effects: [
      { type: 'detect', radius: 12, duration: 12 },
    ],
    interruptsMovement: false,
  },

  supply_drop: {
    id: 'supply_drop',
    name: 'Supply Drop',
    description: 'Call in additional supply containers.',
    targetType: 'instant',
    cooldown: 0,
    resourceCost: { minerals: 400 },
    effects: [
      { type: 'resource' }, // Grants supply
    ],
    requiresResearch: ['supply_drop'],
    interruptsMovement: false,
  },

  // === NAVAL ABILITIES ===

  boost: {
    id: 'boost',
    name: 'Boost',
    description: 'Engage emergency thrusters for a burst of speed.',
    targetType: 'instant',
    cooldown: 15,
    duration: 4,
    effects: [
      { type: 'buff', value: 1.75, duration: 4 }, // 75% speed boost
    ],
    interruptsMovement: false,
    soundEffect: 'ability_boost',
  },

  flak_barrage: {
    id: 'flak_barrage',
    name: 'Flak Barrage',
    description: 'Release a barrage of flak rounds, dealing damage to all air units in the area.',
    targetType: 'instant',
    energyCost: 50,
    cooldown: 10,
    radius: 6,
    effects: [
      {
        type: 'damage',
        value: 40,
        radius: 6,
        targetFilter: { requiresAir: true, includeEnemies: true },
      },
    ],
    interruptsMovement: false,
    visualEffect: 'flak_explosion',
    soundEffect: 'ability_flak',
  },

  submerge: {
    id: 'submerge',
    name: 'Submerge',
    description: 'Dive beneath the surface, becoming invisible to units without detection.',
    targetType: 'toggle',
    cooldown: 3, // Brief cooldown to prevent rapid toggle abuse
    effects: [
      { type: 'cloak' },
      { type: 'custom', customHandler: 'toggleSubmerge' },
    ],
    interruptsMovement: false,
    soundEffect: 'submarine_dive',
  },

  depth_charge_defense: {
    id: 'depth_charge_defense',
    name: 'Depth Charge',
    description: 'Launch depth charges that deal heavy damage to naval units.',
    targetType: 'targeted',
    range: 5,
    energyCost: 25,
    cooldown: 8,
    effects: [
      {
        type: 'damage',
        value: 75,
        targetFilter: { includeEnemies: true },
      },
    ],
    interruptsMovement: false,
    visualEffect: 'depth_charge_explosion',
    soundEffect: 'ability_depth_charge',
  },

  beach_assault: {
    id: 'beach_assault',
    name: 'Beach Assault',
    description: 'Prepare for amphibious landing, granting loaded units a combat bonus upon disembark.',
    targetType: 'instant',
    cooldown: 30,
    duration: 15,
    effects: [
      { type: 'buff', value: 1.25, duration: 15 }, // 25% damage boost to unloaded units
    ],
    interruptsMovement: false,
    soundEffect: 'ability_beach_assault',
  },

  amphibious_mode: {
    id: 'amphibious_mode',
    name: 'Amphibious Mode',
    description: 'Toggle between water and land movement. Slower on land but can traverse both terrains.',
    targetType: 'toggle',
    cooldown: 2,
    effects: [
      { type: 'custom', customHandler: 'toggleAmphibious' },
    ],
    interruptsMovement: true,
    soundEffect: 'vehicle_transform',
  },

  shore_bombardment: {
    id: 'shore_bombardment',
    name: 'Shore Bombardment',
    description: 'Fire a salvo of heavy shells at a ground target location.',
    targetType: 'ground',
    range: 14,
    radius: 3,
    energyCost: 75,
    cooldown: 12,
    castTime: 1.5, // Brief aiming delay
    effects: [
      { type: 'damage', value: 100, radius: 3 },
    ],
    interruptsMovement: false,
    visualEffect: 'artillery_strike',
    soundEffect: 'ability_bombardment',
  },

  yamato_cannon: {
    id: 'yamato_cannon',
    name: 'Yamato Cannon',
    description: 'Fire the main battery, dealing devastating damage to a single target.',
    targetType: 'targeted',
    range: 10,
    energyCost: 150,
    cooldown: 60,
    castTime: 2, // Charge-up time
    effects: [
      { type: 'damage', value: 300 },
    ],
    channeled: true,
    interruptsMovement: true,
    visualEffect: 'yamato_beam',
    soundEffect: 'ability_yamato',
  },
};

// ==================== ABILITY REGISTRY ====================

/**
 * Ability Registry class for managing and querying abilities.
 */
class AbilityRegistryClass {
  private abilities: Map<string, AbilityDataDefinition> = new Map();
  private initialized: boolean = false;

  public initialize(): void {
    if (this.initialized) return;

    for (const [id, def] of Object.entries(ABILITY_DEFINITIONS)) {
      this.abilities.set(id, def);
    }

    this.initialized = true;
  }

  public get(abilityId: string): AbilityDataDefinition | undefined {
    this.initialize();
    return this.abilities.get(abilityId);
  }

  public getAll(): Map<string, AbilityDataDefinition> {
    this.initialize();
    return this.abilities;
  }

  public register(ability: AbilityDataDefinition): void {
    this.abilities.set(ability.id, ability);
  }

  public getByActivationMode(mode: AbilityActivationMode): AbilityDataDefinition[] {
    this.initialize();
    return Array.from(this.abilities.values()).filter(a => a.targetType === mode);
  }

  public getAutocastAbilities(): AbilityDataDefinition[] {
    this.initialize();
    return Array.from(this.abilities.values()).filter(a => a.canAutocast);
  }

  public getAbilitiesRequiringResearch(researchId: string): AbilityDataDefinition[] {
    this.initialize();
    return Array.from(this.abilities.values()).filter(
      a => a.requiresResearch?.includes(researchId)
    );
  }

  public clear(): void {
    this.abilities.clear();
    this.initialized = false;
  }
}

export const AbilityRegistry = new AbilityRegistryClass();

// ==================== HELPER FUNCTIONS ====================

/**
 * Get an ability data definition by ID.
 */
export function getAbility(abilityId: string): AbilityDataDefinition | undefined {
  return AbilityRegistry.get(abilityId);
}

/**
 * Check if a unit has a specific ability.
 */
export function unitHasAbility(unitAbilities: string[] | undefined, abilityId: string): boolean {
  return unitAbilities?.includes(abilityId) ?? false;
}

/**
 * Get all abilities for a unit.
 */
export function getUnitAbilities(abilityIds: string[] | undefined): AbilityDataDefinition[] {
  if (!abilityIds) return [];
  return abilityIds.map(id => AbilityRegistry.get(id)).filter((a): a is AbilityDataDefinition => a !== undefined);
}

/**
 * Check if an ability can be used (energy, cooldown, etc.).
 */
export function canUseAbility(
  ability: AbilityDataDefinition,
  currentEnergy: number,
  currentHealth: number,
  cooldownRemaining: number,
  researchCompleted: Set<string>
): { canUse: boolean; reason?: string } {
  // Check cooldown
  if (cooldownRemaining > 0) {
    return { canUse: false, reason: 'On cooldown' };
  }

  // Check energy
  if (ability.energyCost && currentEnergy < ability.energyCost) {
    return { canUse: false, reason: 'Not enough energy' };
  }

  // Check health cost
  if (ability.healthCost && currentHealth <= ability.healthCost) {
    return { canUse: false, reason: 'Not enough health' };
  }

  // Check research requirements
  if (ability.requiresResearch) {
    for (const researchId of ability.requiresResearch) {
      if (!researchCompleted.has(researchId)) {
        return { canUse: false, reason: 'Research required' };
      }
    }
  }

  return { canUse: true };
}

/**
 * Calculate ability damage with modifiers.
 */
export function calculateAbilityDamage(
  ability: AbilityDataDefinition,
  bonusDamage: number = 0
): number {
  const damageEffect = ability.effects.find(e => e.type === 'damage');
  if (!damageEffect || damageEffect.value === undefined) return 0;

  return damageEffect.value + bonusDamage;
}

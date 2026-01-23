import { UnitDefinition, TransformMode } from '@/engine/components/Unit';

// Transform modes for Devastator
const DEVASTATOR_MODES: TransformMode[] = [
  {
    id: 'tank',
    name: 'Tank Mode',
    speed: 3.15,
    attackRange: 7,
    attackDamage: 15,
    attackSpeed: 0.74,
    splashRadius: 0.5,
    sightRange: 11,
    canMove: true,
    transformTime: 2,
    canAttackGround: true,
    canAttackAir: false, // Artillery - cannot target air
    projectileType: 'shell_tank',
  },
  {
    id: 'siege',
    name: 'Siege Mode',
    speed: 0,
    attackRange: 13,
    attackDamage: 40,
    attackSpeed: 0.47,
    splashRadius: 1.25,
    sightRange: 11,
    canMove: false,
    transformTime: 2,
    canAttackGround: true,
    canAttackAir: false, // Artillery - cannot target air
    projectileType: 'shell_siege', // Arcing siege shells
  },
];

// Transform modes for Scorcher/Inferno
const SCORCHER_MODES: TransformMode[] = [
  {
    id: 'scorcher',
    name: 'Scorcher',
    speed: 5.95,
    attackRange: 5,
    attackDamage: 8,
    attackSpeed: 1.8,
    splashRadius: 2,
    sightRange: 10,
    canMove: true,
    transformTime: 2,
    canAttackGround: true,
    canAttackAir: false, // Flamethrower - cannot target air
    projectileType: 'instant_flame',
  },
  {
    id: 'inferno',
    name: 'Inferno',
    speed: 3.15,
    attackRange: 2,
    attackDamage: 18,
    attackSpeed: 1.4,
    splashRadius: 1.5,
    sightRange: 10,
    canMove: true,
    transformTime: 2,
    canAttackGround: true,
    canAttackAir: false, // Flamethrower - cannot target air
    projectileType: 'instant_flame',
  },
];

// Transform modes for Valkyrie
const VALKYRIE_MODES: TransformMode[] = [
  {
    id: 'fighter',
    name: 'Fighter Mode',
    speed: 3.85,
    attackRange: 9,
    attackDamage: 10,
    attackSpeed: 0.71,
    sightRange: 10,
    isFlying: true,
    canMove: true,
    transformTime: 2.25,
    canAttackGround: false, // Air superiority fighter - air only
    canAttackAir: true,
    projectileType: 'missile_aa', // Anti-air missiles
  },
  {
    id: 'assault',
    name: 'Assault Mode',
    speed: 3.15,
    attackRange: 6,
    attackDamage: 12,
    attackSpeed: 0.71,
    sightRange: 10,
    isFlying: false,
    canMove: true,
    transformTime: 2.25,
    canAttackGround: true, // Ground assault mode - ground only
    canAttackAir: false,   // Cannot attack air in assault mode (RTS-style Viking)
    projectileType: 'missile_ground', // Ground attack missiles
  },
];

export const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  fabricator: {
    id: 'fabricator',
    name: 'Fabricator',
    description: 'Worker unit that gathers resources and constructs buildings.',
    faction: 'dominion',
    mineralCost: 50,
    vespeneCost: 0,
    buildTime: 12,
    supplyCost: 1,
    speed: 4,
    acceleration: 50, // Workers have visible but quick acceleration
    sightRange: 8,
    attackRange: 1,
    attackDamage: 5,
    attackSpeed: 0.7,
    damageType: 'normal',
    projectileType: 'instant_melee', // Melee attack, instant damage
    maxHealth: 45,
    armor: 0,
    isWorker: true,
    isMechanical: true,
    canRepair: true,
    canAttackGround: true,
    canAttackAir: false, // Melee worker - ground only
    // Data-driven fields for abstraction
    targetPriority: 10, // Low priority - workers are not high-value targets
    category: 'worker',
    armorType: 'light',
    // Audio configuration - references config files
    audio: {
      voiceGroupId: 'fabricator',
      weaponSound: 'attack_rifle',
      deathSound: 'unit_death',
    },
  },

  trooper: {
    id: 'trooper',
    name: 'Trooper',
    description: 'Basic infantry unit. Cheap and effective in large numbers. Attacks ground and air.',
    faction: 'dominion',
    mineralCost: 50,
    vespeneCost: 0,
    buildTime: 18,
    supplyCost: 1,
    speed: 3.15, // Marine base speed
    acceleration: 1000, // Instant acceleration RTS-style ground units
    sightRange: 9,
    attackRange: 5,
    attackDamage: 6,
    attackSpeed: 0.86,
    damageType: 'normal',
    projectileType: 'bullet_rifle', // Standard rifle bullets
    maxHealth: 45,
    armor: 0,
    abilities: ['stim_pack'],
    isBiological: true,
    canAttackGround: true,
    canAttackAir: true, // Rifle infantry - can shoot air
    // Data-driven fields for abstraction
    targetPriority: 60, // Standard infantry priority
    category: 'infantry',
    armorType: 'light',
    audio: {
      voiceGroupId: 'trooper',
      weaponSound: 'attack_rifle',
      deathSound: 'unit_death_bio',
    },
  },

  breacher: {
    id: 'breacher',
    name: 'Breacher',
    description: 'Heavy armored infantry. Effective against armored units. Attacks ground and air.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 25,
    buildTime: 21,
    supplyCost: 2,
    speed: 3.15, // Marauder base speed
    acceleration: 1000, // Instant acceleration RTS-style ground units
    sightRange: 10,
    attackRange: 6,
    attackDamage: 10,
    attackSpeed: 0.7,
    damageType: 'concussive',
    projectileType: 'bullet_heavy', // Heavy concussive rounds
    maxHealth: 125,
    armor: 1,
    abilities: ['stim_pack', 'concussive_shells'],
    isBiological: true,
    canAttackGround: true,
    canAttackAir: true, // Heavy rifle - can shoot air
    audio: {
      voiceGroupId: 'breacher',
      weaponSound: 'attack_grenade',
      deathSound: 'unit_death_bio',
    },
  },

  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    description: 'Fast assault infantry with jetpacks and grenades. Attacks ground and air.',
    faction: 'dominion',
    mineralCost: 50,
    vespeneCost: 50,
    buildTime: 32,
    supplyCost: 1,
    speed: 5.25, // Reaper speed
    acceleration: 1000, // Instant acceleration RTS-style ground units
    sightRange: 9,
    attackRange: 5,
    attackDamage: 4,
    attackSpeed: 1.1,
    damageType: 'normal',
    projectileType: 'bullet_rifle', // Light rifle fire
    maxHealth: 60,
    armor: 0,
    abilities: ['jet_pack', 'grenade'],
    isBiological: true,
    canAttackGround: true,
    canAttackAir: true, // Jetpack infantry - can engage air
    audio: {
      voiceGroupId: 'vanguard',
      weaponSound: 'attack_gatling',
      deathSound: 'unit_death_bio',
    },
  },

  operative: {
    id: 'operative',
    name: 'Operative',
    description: 'Elite stealth unit. Can cloak, snipe, and call nuclear strikes. Attacks ground and air.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 125,
    buildTime: 29,
    supplyCost: 2,
    speed: 3.94, // Ghost speed
    acceleration: 1000, // Instant acceleration RTS-style ground units
    sightRange: 11,
    attackRange: 6,
    attackDamage: 10,
    attackSpeed: 0.86,
    damageType: 'normal',
    projectileType: 'bullet_sniper', // High-velocity sniper rounds
    maxHealth: 100,
    armor: 0,
    abilities: ['snipe', 'emp_round', 'cloak', 'nuke'],
    isBiological: true,
    canCloak: true,
    cloakEnergyCost: 1,
    canAttackGround: true,
    canAttackAir: true, // Sniper rifle - can target air
    audio: {
      voiceGroupId: 'operative',
      weaponSound: 'attack_sniper',
      deathSound: 'unit_death_bio',
    },
  },

  scorcher: {
    id: 'scorcher',
    name: 'Scorcher',
    description: 'Fast attack vehicle with flame weapons. Transforms into Inferno. Ground only.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 0,
    buildTime: 21,
    supplyCost: 2,
    speed: 5.95, // Hellion speed
    acceleration: 800, // Vehicles have near-instant but slightly visible acceleration
    sightRange: 10,
    attackRange: 5,
    attackDamage: 8,
    attackSpeed: 1.8,
    damageType: 'explosive',
    projectileType: 'instant_flame', // Flame weapon, instant damage
    maxHealth: 90,
    armor: 0,
    abilities: ['transform_inferno'],
    splashRadius: 2,
    isMechanical: true,
    canTransform: true,
    transformModes: SCORCHER_MODES,
    defaultMode: 'scorcher',
    canAttackGround: true,
    canAttackAir: false, // Flamethrower - cannot target air
    audio: {
      voiceGroupId: 'scorcher',
      weaponSound: 'attack_flamethrower',
      deathSound: 'unit_death_mech',
    },
  },

  devastator: {
    id: 'devastator',
    name: 'Devastator',
    description: 'Heavy siege tank. Transforms into siege mode for long-range artillery. Ground only.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 125,
    buildTime: 32,
    supplyCost: 3,
    speed: 3.15, // Siege Tank speed
    acceleration: 800, // Vehicles have near-instant but slightly visible acceleration
    sightRange: 11,
    attackRange: 7,
    attackDamage: 15,
    attackSpeed: 0.74,
    damageType: 'explosive',
    projectileType: 'shell_tank', // Tank shells (siege mode uses shell_siege via transform)
    maxHealth: 175,
    armor: 1,
    abilities: ['bombardment_mode'],
    splashRadius: 0.5,
    isMechanical: true,
    canTransform: true,
    transformModes: DEVASTATOR_MODES,
    defaultMode: 'tank',
    canAttackGround: true,
    canAttackAir: false, // Artillery - cannot target air
    // Data-driven fields for abstraction
    targetPriority: 100, // High priority - siege units are high-value targets
    category: 'vehicle',
    armorType: 'armored',
    audio: {
      voiceGroupId: 'devastator',
      weaponSound: 'attack_cannon',
      deathSound: 'unit_death_mech',
    },
  },

  colossus: {
    id: 'colossus',
    name: 'Colossus',
    description: 'Massive walker mech. Devastating heavy firepower. Attacks ground and air.',
    faction: 'dominion',
    mineralCost: 300,
    vespeneCost: 200,
    buildTime: 43,
    supplyCost: 6,
    speed: 2.62, // Thor speed
    acceleration: 600, // Heavy mechs accelerate slower but still responsive
    sightRange: 11,
    attackRange: 7,
    attackDamage: 30,
    attackSpeed: 0.9,
    damageType: 'explosive',
    projectileType: 'shell_tank', // Heavy cannon shells
    maxHealth: 400,
    armor: 2,
    abilities: ['high_impact_payload'],
    isMechanical: true,
    canAttackGround: true,
    canAttackAir: true, // Heavy weapons platform - can target both
    audio: {
      voiceGroupId: 'colossus',
      weaponSound: 'attack_laser_battery',
      deathSound: 'unit_death_mech',
    },
  },

  lifter: {
    id: 'lifter',
    name: 'Lifter',
    description: 'Flying transport and medical support. Heals nearby units. No attack.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 100,
    buildTime: 30,
    supplyCost: 2,
    speed: 3.5, // Medivac speed
    acceleration: 3.15, // Medivac acceleration - floaty air unit feel
    sightRange: 11,
    attackRange: 0,
    attackDamage: 0,
    attackSpeed: 0,
    damageType: 'normal',
    maxHealth: 150,
    armor: 1,
    abilities: ['heal', 'load', 'unload', 'afterburners'],
    isFlying: true,
    isMechanical: true,
    isTransport: true,
    transportCapacity: 8,
    canHeal: true,
    healRange: 4,
    healRate: 12.6,
    healEnergyCost: 1,
    canAttackGround: false, // Support unit - no attack
    canAttackAir: false,
    audio: {
      voiceGroupId: 'lifter',
      deathSound: 'unit_death_mech',
    },
  },

  valkyrie: {
    id: 'valkyrie',
    name: 'Valkyrie',
    description: 'Transforming fighter. Fighter mode (flying): attacks air only. Assault mode (ground): attacks ground only.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 75,
    buildTime: 30,
    supplyCost: 2,
    speed: 3.85, // Viking air speed
    acceleration: 4.55, //-style air acceleration - responsive fighter
    sightRange: 10,
    attackRange: 9,
    attackDamage: 10,
    attackSpeed: 0.71,
    damageType: 'explosive',
    projectileType: 'missile_aa', // Anti-air missiles
    maxHealth: 135,
    armor: 0,
    abilities: ['transform_assault'],
    isFlying: true,
    isMechanical: true,
    canTransform: true,
    transformModes: VALKYRIE_MODES,
    defaultMode: 'fighter',
    canAttackGround: false, // Fighter mode starts air-only
    canAttackAir: true,
    audio: {
      voiceGroupId: 'valkyrie',
      weaponSound: 'attack_missile',
      deathSound: 'unit_death_mech',
    },
  },

  specter: {
    id: 'specter',
    name: 'Specter',
    description: 'Cloakable strike fighter. Stealthy air superiority. Attacks ground and air.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 100,
    buildTime: 43,
    supplyCost: 3,
    speed: 3.85, // Banshee speed
    acceleration: 4.55, // Banshee acceleration - responsive strike craft
    sightRange: 10,
    attackRange: 6,
    attackDamage: 12,
    attackSpeed: 0.89,
    damageType: 'normal',
    projectileType: 'laser_fighter', // Fighter laser bolts
    maxHealth: 140,
    armor: 0,
    abilities: ['cloak'],
    isFlying: true,
    isMechanical: true,
    canCloak: true,
    cloakEnergyCost: 1,
    canAttackGround: true,
    canAttackAir: true, // Strike fighter - can target both
    audio: {
      voiceGroupId: 'specter',
      weaponSound: 'attack_laser',
      deathSound: 'unit_death_mech',
    },
  },

  dreadnought: {
    id: 'dreadnought',
    name: 'Dreadnought',
    description: 'Massive capital ship with continuous laser cannon and devastating Power Cannon. Attacks ground and air.',
    faction: 'dominion',
    mineralCost: 400,
    vespeneCost: 300,
    buildTime: 64,
    supplyCost: 6,
    speed: 2.62,
    acceleration: 1.4, // Sluggish capital ship
    sightRange: 12,
    attackRange: 10, // Capital ship - greater range than most units
    attackDamage: 12,
    attackSpeed: 2.0, // Continuous laser fire - very fast attack speed
    damageType: 'psionic', // Uses laser visual effect
    projectileType: 'instant_beam', // Continuous beam weapon, instant damage
    maxHealth: 550,
    armor: 3,
    abilities: ['power_cannon', 'warp_jump'],
    maxEnergy: 200,
    energyRegen: 0.5625, // SC2 standard energy regen rate
    isFlying: true,
    isMechanical: true,
    canAttackGround: true,
    canAttackAir: true, // Capital ship - can target both
    canAttackWhileMoving: true, // Capital ship turrets track targets while moving
    // Data-driven fields for abstraction
    targetPriority: 95, // Highest priority - capital ships are critical targets
    category: 'ship',
    armorType: 'massive',
    audio: {
      voiceGroupId: 'dreadnought',
      weaponSound: 'attack_laser',
      deathSound: 'explosion_large',
    },
  },

  // Detector unit - Overseer
  overseer: {
    id: 'overseer',
    name: 'Overseer',
    description: 'Support craft with detection. Reveals cloaked and burrowed units. No attack.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 200,
    buildTime: 43,
    supplyCost: 2,
    speed: 4.13, // Raven speed
    acceleration: 2.975, //-style support craft acceleration
    sightRange: 11,
    attackRange: 0,
    attackDamage: 0,
    attackSpeed: 0,
    damageType: 'normal',
    maxHealth: 140,
    armor: 1,
    abilities: ['auto_turret', 'interference_matrix', 'anti_armor_missile'],
    isFlying: true,
    isMechanical: true,
    isDetector: true,
    detectionRange: 11,
    canAttackGround: false, // Detector - no attack
    canAttackAir: false,
    audio: {
      voiceGroupId: 'overseer',
      deathSound: 'unit_death_mech',
    },
  },

  // ==================== NAVAL UNITS ====================

  mariner: {
    id: 'mariner',
    name: 'Mariner',
    description: 'Naval worker unit. Constructs naval buildings and repairs ships.',
    faction: 'dominion',
    mineralCost: 75,
    vespeneCost: 0,
    buildTime: 15,
    supplyCost: 1,
    speed: 4.5,
    acceleration: 50, // Worker-style acceleration
    sightRange: 8,
    attackRange: 1,
    attackDamage: 5,
    attackSpeed: 0.7,
    damageType: 'normal',
    projectileType: 'instant_melee',
    maxHealth: 60,
    armor: 0,
    isWorker: true,
    isMechanical: true,
    canRepair: true,
    canAttackGround: false,
    canAttackAir: false,
    canAttackNaval: true,
    isNaval: true,
    movementDomain: 'water',
    targetPriority: 10,
    category: 'worker',
    armorType: 'light',
    audio: {
      voiceGroupId: 'mariner',
      weaponSound: 'attack_rifle',
      deathSound: 'unit_death_mech',
    },
  },

  stingray: {
    id: 'stingray',
    name: 'Stingray',
    description: 'Fast patrol boat. Excellent for scouting and harassment. Attacks ground, air, and naval.',
    faction: 'dominion',
    mineralCost: 100,
    vespeneCost: 0,
    buildTime: 20,
    supplyCost: 2,
    speed: 6.5, // Fastest naval unit
    acceleration: 600,
    sightRange: 10,
    attackRange: 6,
    attackDamage: 8,
    attackSpeed: 0.9,
    damageType: 'normal',
    projectileType: 'bullet_rifle',
    maxHealth: 120,
    armor: 0,
    abilities: ['boost'],
    isMechanical: true,
    canAttackGround: true,
    canAttackAir: true,
    canAttackNaval: true,
    isNaval: true,
    movementDomain: 'water',
    targetPriority: 65,
    category: 'naval',
    armorType: 'light',
    audio: {
      voiceGroupId: 'stingray',
      weaponSound: 'attack_gatling',
      deathSound: 'unit_death_mech',
    },
  },

  corsair: {
    id: 'corsair',
    name: 'Corsair',
    description: 'Anti-air missile frigate. Specializes in air defense with secondary torpedoes.',
    faction: 'dominion',
    mineralCost: 150,
    vespeneCost: 75,
    buildTime: 30,
    supplyCost: 3,
    speed: 3.5,
    acceleration: 400,
    sightRange: 11,
    attackRange: 8,
    attackDamage: 24, // 12 x 2 missiles
    attackSpeed: 0.7,
    damageType: 'explosive',
    projectileType: 'missile_aa',
    maxHealth: 200,
    armor: 1,
    abilities: ['flak_barrage'],
    maxEnergy: 100,
    energyRegen: 0.5625,
    isMechanical: true,
    canAttackGround: false, // Anti-air specialist
    canAttackAir: true,
    canAttackNaval: true, // Secondary torpedoes
    isNaval: true,
    movementDomain: 'water',
    targetPriority: 78,
    category: 'naval',
    armorType: 'armored',
    audio: {
      voiceGroupId: 'corsair',
      weaponSound: 'attack_missile',
      deathSound: 'unit_death_mech',
    },
  },

  leviathan: {
    id: 'leviathan',
    name: 'Leviathan',
    description: 'Heavy battlecruiser. Devastating shore bombardment and naval combat capability.',
    faction: 'dominion',
    mineralCost: 350,
    vespeneCost: 250,
    buildTime: 60,
    supplyCost: 6,
    speed: 2.25, // Slowest naval unit - massive capital ship
    acceleration: 200,
    sightRange: 12,
    attackRange: 10,
    attackDamage: 25,
    attackSpeed: 0.5,
    damageType: 'explosive',
    projectileType: 'shell_siege',
    splashRadius: 1.5,
    maxHealth: 500,
    armor: 3,
    abilities: ['shore_bombardment', 'yamato_cannon'],
    maxEnergy: 200,
    energyRegen: 0.5625,
    isMechanical: true,
    canAttackGround: true, // Shore bombardment
    canAttackAir: false, // No anti-air
    canAttackNaval: true,
    canAttackWhileMoving: true,
    isNaval: true,
    movementDomain: 'water',
    targetPriority: 92,
    category: 'naval',
    armorType: 'massive',
    audio: {
      voiceGroupId: 'leviathan',
      weaponSound: 'attack_cannon',
      deathSound: 'explosion_large',
    },
  },

  hunter: {
    id: 'hunter',
    name: 'Hunter',
    description: 'Attack submarine. Cloaked when submerged. Devastating torpedoes against ships.',
    faction: 'dominion',
    mineralCost: 200,
    vespeneCost: 150,
    buildTime: 45,
    supplyCost: 4,
    speed: 3.0, // Surfaced speed
    acceleration: 300,
    sightRange: 9,
    attackRange: 7,
    attackDamage: 35,
    attackSpeed: 0.4,
    damageType: 'torpedo',
    projectileType: 'torpedo',
    maxHealth: 175,
    armor: 1,
    abilities: ['submerge', 'depth_charge_defense'],
    isMechanical: true,
    canCloak: true, // Cloaked when submerged
    cloakEnergyCost: 0, // Free cloak when submerged
    canAttackGround: false, // Torpedoes only hit naval (deck gun when surfaced via ability)
    canAttackAir: false,
    canAttackNaval: true,
    isNaval: true,
    isSubmarine: true,
    canSubmerge: true,
    submergedSpeed: 2.0, // Slower when submerged
    movementDomain: 'water',
    targetPriority: 82,
    category: 'naval',
    armorType: 'armored',
    audio: {
      voiceGroupId: 'hunter',
      weaponSound: 'attack_torpedo',
      deathSound: 'unit_death_mech',
    },
  },

  kraken: {
    id: 'kraken',
    name: 'Kraken',
    description: 'Amphibious assault ship. Transports troops and operates on water and land.',
    faction: 'dominion',
    mineralCost: 200,
    vespeneCost: 100,
    buildTime: 40,
    supplyCost: 3,
    speed: 3.5, // Water speed
    acceleration: 400,
    sightRange: 10,
    attackRange: 6,
    attackDamage: 30, // 15 x 2 cannons
    attackSpeed: 0.8,
    damageType: 'normal',
    projectileType: 'shell_tank',
    maxHealth: 250,
    armor: 2,
    abilities: ['beach_assault', 'amphibious_mode'],
    isMechanical: true,
    isTransport: true,
    transportCapacity: 8,
    canAttackGround: true,
    canAttackAir: false,
    canAttackNaval: true,
    isNaval: true,
    movementDomain: 'amphibious',
    targetPriority: 48,
    category: 'naval',
    armorType: 'armored',
    audio: {
      voiceGroupId: 'kraken',
      weaponSound: 'attack_cannon',
      deathSound: 'unit_death_mech',
    },
  },
};

export const DOMINION_UNITS = Object.values(UNIT_DEFINITIONS);

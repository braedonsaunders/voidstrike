/**
 * Dominion Faction AI Configuration
 *
 * This file contains ALL AI behavior configuration for the Dominion faction.
 * Modifying this file will change AI behavior without touching engine code.
 *
 * To create a new faction:
 * 1. Copy this file
 * 2. Update unit/building IDs to match your faction
 * 3. Tune values as needed
 * 4. Register in src/data/ai/index.ts
 */

import {
  type AIPersonality,
  type CompositionGoal,
  type FactionAIConfig,
  type MacroRule,
  registerFactionAIConfig,
} from '../aiConfig';

// ==================== MACRO RULES ====================
// These replace all hardcoded production logic in EnhancedAISystem

const DOMINION_MACRO_RULES: MacroRule[] = [
  // === CRITICAL: Supply Management ===
  // Build supply when we're getting close to capped
  {
    id: 'supply_early',
    name: 'Build Supply (Early)',
    description: 'Build supply cache before getting supply blocked',
    priority: 100, // Highest priority - never get supply blocked
    conditions: [
      { type: 'supplyRatio', operator: '>=', value: 0.7 },
      { type: 'minerals', operator: '>=', value: 100 }, // Match supply cache cost to prevent deadlocks
    ],
    action: { type: 'build', targetId: 'supply_cache' },
    cooldownTicks: 40, // ~2 seconds
  },

  // Emergency supply - we're almost blocked
  {
    id: 'supply_emergency',
    name: 'Build Supply (Emergency)',
    description: 'Emergency supply when nearly blocked',
    priority: 150, // Even higher priority
    conditions: [
      { type: 'supplyRatio', operator: '>=', value: 0.85 },
      { type: 'minerals', operator: '>=', value: 100 }, // Match supply cache cost to prevent deadlocks
    ],
    action: { type: 'build', targetId: 'supply_cache' },
    cooldownTicks: 15, // Faster cooldown for emergencies
  },

  // === Worker Production ===
  // Emergency worker replacement - high priority when under harassment
  {
    id: 'workers_emergency',
    name: 'Emergency Worker Replacement',
    description: 'Rapidly replace workers lost to harassment',
    priority: 120, // Higher than supply management
    conditions: [
      { type: 'workerReplacementPriority', operator: '>=', value: 0.5 },
      { type: 'minerals', operator: '>=', value: 50 },
      { type: 'supplyRatio', operator: '<', value: 0.98 },
    ],
    action: { type: 'train', targetId: 'fabricator' },
    cooldownTicks: 10, // Very fast - queue multiple workers
  },

  // Opening worker production - keep economy growing before supply pressure
  {
    id: 'workers_opening',
    name: 'Train Workers (Opening)',
    description: 'Train workers early before supply pressure kicks in',
    priority: 95,
    conditions: [
      // workerSaturation = workers / (bases * 16), so < 1.0 means under-saturated
      { type: 'workerSaturation', operator: '<', value: 1.2 }, // Allow slight over-saturation for smoother production
      { type: 'minerals', operator: '>=', value: 50 },
      { type: 'supplyRatio', operator: '<', value: 0.7 }, // Bank for supply once pressure starts
    ],
    action: { type: 'train', targetId: 'fabricator' },
    cooldownTicks: 25, // Slightly faster worker production
  },

  // Standard worker production - caps at 16 per base (optimal saturation)
  {
    id: 'workers_basic',
    name: 'Train Workers',
    description: 'Keep worker production going up to optimal saturation',
    priority: 90,
    conditions: [
      // workerSaturation = workers / (bases * 16), so < 1.0 means under-saturated
      { type: 'workerSaturation', operator: '<', value: 1.2 }, // Allow slight over-saturation for smoother production
      { type: 'minerals', operator: '>=', value: 100 }, // Bank for supply cache cost
      { type: 'supplyRatio', operator: '<', value: 0.9 }, // Stop earlier to leave room for army
    ],
    action: { type: 'train', targetId: 'fabricator' },
    cooldownTicks: 25, // Slightly faster worker production
  },

  // === Production Building Scaling ===
  // First infantry bay - LOW threshold to ensure it gets built
  {
    id: 'infantry_bay_first',
    name: 'First Infantry Bay',
    description: 'Build first production building',
    priority: 85,
    conditions: [
      { type: 'workers', operator: '>=', value: 6 }, // Lowered from 10 - build early
      { type: 'buildingCount', operator: '==', value: 0, targetId: 'infantry_bay' },
      { type: 'minerals', operator: '>=', value: 150 },
    ],
    action: { type: 'build', targetId: 'infantry_bay' },
    cooldownTicks: 60, // Faster retry
  },

  // Second infantry bay - ALL DIFFICULTIES need to scale production
  {
    id: 'infantry_bay_scale',
    name: 'Scale Infantry Bays',
    description: 'Build more production as economy grows',
    priority: 70,
    conditions: [
      { type: 'workers', operator: '>=', value: 12 }, // Lowered from 16 - easier to trigger
      { type: 'armySupply', operator: '>=', value: 2 }, // Lowered from 4
      { type: 'minerals', operator: '>=', value: 150 },
      // Have at least 1 infantry bay already
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      // But less than bases * 2
      {
        type: 'buildingCount',
        operator: '<',
        value: 2,
        targetId: 'infantry_bay',
        compareRef: 'bases',
        compareMultiplier: 2,
      },
    ],
    action: { type: 'build', targetId: 'infantry_bay' },
    cooldownTicks: 200,
    // NO difficulties restriction - ALL difficulties can scale production
  },

  // Third+ infantry bay for aggressive macro
  {
    id: 'infantry_bay_aggressive',
    name: 'Aggressive Infantry Bay Scaling',
    description: 'More production for harder difficulties',
    priority: 65,
    conditions: [
      { type: 'workers', operator: '>=', value: 20 }, // Lowered from 24
      { type: 'minerals', operator: '>=', value: 175 },
      { type: 'buildingCount', operator: '<', value: 4, targetId: 'infantry_bay' },
      { type: 'bases', operator: '>=', value: 1 }, // Can do with 1 base on hard+
    ],
    action: { type: 'build', targetId: 'infantry_bay' },
    cooldownTicks: 250,
    difficulties: ['medium', 'hard', 'very_hard', 'insane'], // Opened to medium too
  },

  // === Gas Extraction ===
  {
    id: 'extractor_first',
    name: 'First Extractor',
    description: 'Get gas for tech units',
    priority: 80,
    conditions: [
      { type: 'workers', operator: '>=', value: 8 }, // Lowered from 10 - get gas earlier
      { type: 'buildingCount', operator: '==', value: 0, targetId: 'extractor' },
      { type: 'minerals', operator: '>=', value: 75 },
    ],
    action: { type: 'build', targetId: 'extractor' },
    cooldownTicks: 60, // Faster retry
  },

  // Second extractor at main base - most bases have 2 plasma geysers
  {
    id: 'extractor_second',
    name: 'Second Extractor',
    description: 'Build second gas at main base',
    priority: 72,
    conditions: [
      { type: 'workers', operator: '>=', value: 14 },
      { type: 'buildingCount', operator: '==', value: 1, targetId: 'extractor' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'minerals', operator: '>=', value: 75 },
    ],
    action: { type: 'build', targetId: 'extractor' },
    cooldownTicks: 150,
  },

  // Additional extractors at expansions (2 per base)
  {
    id: 'extractor_expansion',
    name: 'Expansion Extractors',
    description: 'Build extractors at new bases',
    priority: 60,
    conditions: [
      { type: 'workers', operator: '>=', value: 18 },
      { type: 'bases', operator: '>=', value: 2 },
      // extractors < bases * 2 (2 per base)
      {
        type: 'buildingCount',
        operator: '<',
        value: 2,
        targetId: 'extractor',
        compareRef: 'bases',
        compareMultiplier: 2,
      },
      { type: 'minerals', operator: '>=', value: 75 },
    ],
    action: { type: 'build', targetId: 'extractor' },
    cooldownTicks: 150,
  },

  // === Tech Buildings ===
  // Forge for vehicles - ALL difficulties can tech
  {
    id: 'forge_first',
    name: 'First Forge',
    description: 'Tech up to vehicles',
    priority: 75,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'extractor' },
      { type: 'buildingCount', operator: '==', value: 0, targetId: 'forge' },
      { type: 'plasma', operator: '>=', value: 75 }, // Lowered
      { type: 'minerals', operator: '>=', value: 100 }, // Lowered
    ],
    action: { type: 'build', targetId: 'forge' },
    cooldownTicks: 200,
    // NO difficulty restriction - all AI can tech
  },

  // Hangar for air units - ALL difficulties
  {
    id: 'hangar_first',
    name: 'First Hangar',
    description: 'Tech up to air units',
    priority: 70,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'forge' },
      { type: 'buildingCount', operator: '==', value: 0, targetId: 'hangar' },
      { type: 'plasma', operator: '>=', value: 75 }, // Lowered
      { type: 'minerals', operator: '>=', value: 100 }, // Lowered
    ],
    action: { type: 'build', targetId: 'hangar' },
    cooldownTicks: 200,
    // NO difficulty restriction
  },

  // Research modules for tech units - ALL difficulties
  {
    id: 'research_module',
    name: 'Research Module',
    description: 'Build tech lab for advanced units',
    priority: 68,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'plasma', operator: '>=', value: 50 },
      { type: 'minerals', operator: '>=', value: 50 },
    ],
    action: { type: 'build', targetId: 'research_module' },
    cooldownTicks: 250,
    // NO difficulty restriction
  },

  // === Unit Production - Anti-Air Priority ===
  // URGENT: Counter enemy air when we have none
  {
    id: 'counter_air_emergency',
    name: 'Emergency Anti-Air',
    description: 'Build anti-air when enemy has air and we dont',
    priority: 95,
    conditions: [
      { type: 'enemyAirUnits', operator: '>', value: 0 },
      { type: 'hasAntiAir', operator: '==', value: false },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
    ],
    action: {
      type: 'train',
      options: [
        { id: 'trooper', weight: 10 }, // Can attack air
        { id: 'valkyrie', weight: 5 }, // Dedicated anti-air
      ],
    },
    cooldownTicks: 10,
    difficulties: ['hard', 'very_hard', 'insane'],
  },

  // === Scouting-Reactive Rules ===
  {
    id: 'counter_rush_defense',
    name: 'Anti-Rush Defense',
    description: 'Build defensive structures when rush detected',
    priority: 92,
    conditions: [
      { type: 'enemyStrategy', operator: '==', value: 'rush' },
      { type: 'buildingCount', operator: '<', value: 1, targetId: 'bunker' },
      { type: 'minerals', operator: '>=', value: 100 },
    ],
    action: {
      type: 'build',
      targetId: 'bunker',
    },
    cooldownTicks: 200,
    difficulties: ['hard', 'very_hard', 'insane'],
  },
  {
    id: 'counter_tech_aggression',
    name: 'Punish Tech',
    description: 'Attack when enemy is teching with weak army',
    priority: 88,
    conditions: [
      { type: 'enemyStrategy', operator: '==', value: 'tech' },
      { type: 'armySupply', operator: '>=', value: 10 },
      { type: 'gameTime', operator: '>=', value: 800 },
    ],
    action: {
      type: 'attack',
    },
    cooldownTicks: 400,
    difficulties: ['very_hard', 'insane'],
  },
  {
    id: 'counter_air_tech_preemptive',
    name: 'Preemptive Anti-Air',
    description: 'Build anti-air when enemy air tech detected before air units appear',
    priority: 90,
    conditions: [
      { type: 'enemyHasAirTech', operator: '==', value: true },
      { type: 'hasAntiAir', operator: '==', value: false },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
    ],
    action: {
      type: 'train',
      options: [
        { id: 'trooper', weight: 10 },
        { id: 'valkyrie', weight: 5 },
      ],
    },
    cooldownTicks: 10,
    difficulties: ['hard', 'very_hard', 'insane'],
  },

  // === Unit Production - Heavy Units (ALL DIFFICULTIES) ===
  {
    id: 'train_dreadnought',
    name: 'Train Dreadnought',
    description: 'Build capital ship',
    priority: 58,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'hangar' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'research_module' },
      { type: 'plasma', operator: '>=', value: 200 },
      { type: 'minerals', operator: '>=', value: 300 },
      { type: 'armySupply', operator: '>=', value: 12 },
    ],
    action: { type: 'train', targetId: 'dreadnought' },
    cooldownTicks: 80,
  },

  {
    id: 'train_colossus',
    name: 'Train Colossus',
    description: 'Build heavy tank unit',
    priority: 55,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'forge' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'research_module' },
      { type: 'plasma', operator: '>=', value: 150 }, // Lowered
      { type: 'minerals', operator: '>=', value: 250 }, // Lowered
    ],
    action: { type: 'train', targetId: 'colossus' },
    cooldownTicks: 50,
    // NO difficulty restriction
  },

  {
    id: 'train_devastator',
    name: 'Train Devastator',
    description: 'Build medium tank unit',
    priority: 52,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'forge' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'research_module' },
      { type: 'plasma', operator: '>=', value: 100 }, // Lowered
      { type: 'minerals', operator: '>=', value: 150 }, // Lowered
    ],
    action: { type: 'train', targetId: 'devastator' },
    cooldownTicks: 40,
    // NO difficulty restriction
  },

  // === Unit Production - Air Units (ALL DIFFICULTIES) ===
  {
    id: 'train_valkyrie',
    name: 'Train Valkyrie',
    description: 'Build anti-air fighter',
    priority: 50,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'hangar' },
      { type: 'plasma', operator: '>=', value: 50 }, // Lowered
      { type: 'minerals', operator: '>=', value: 100 }, // Lowered
    ],
    action: { type: 'train', targetId: 'valkyrie' },
    cooldownTicks: 40,
    // NO difficulty restriction
  },

  {
    id: 'train_specter',
    name: 'Train Specter',
    description: 'Build cloaked air unit',
    priority: 48,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'hangar' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'research_module' },
      { type: 'plasma', operator: '>=', value: 75 }, // Lowered
      { type: 'minerals', operator: '>=', value: 100 }, // Lowered
    ],
    action: { type: 'train', targetId: 'specter' },
    cooldownTicks: 50,
    // NO difficulty restriction
  },

  // === Unit Production - Vehicles (ALL DIFFICULTIES) ===
  {
    id: 'train_scorcher',
    name: 'Train Scorcher',
    description: 'Build fast harassment vehicle',
    priority: 46,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'forge' },
      { type: 'plasma', operator: '>=', value: 25 },
      { type: 'minerals', operator: '>=', value: 75 },
    ],
    action: { type: 'train', targetId: 'scorcher' },
    cooldownTicks: 35,
  },

  // === Unit Production - Infantry (ALL DIFFICULTIES) ===
  {
    id: 'train_breacher',
    name: 'Train Breacher',
    description: 'Build anti-armor infantry',
    priority: 44,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'research_module' },
      { type: 'plasma', operator: '>=', value: 25 },
      { type: 'minerals', operator: '>=', value: 50 },
    ],
    action: { type: 'train', targetId: 'breacher' },
    cooldownTicks: 30,
    // NO difficulty restriction
  },

  {
    id: 'train_vanguard',
    name: 'Train Vanguard',
    description: 'Build jetpack infantry',
    priority: 42,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'plasma', operator: '>=', value: 50 },
      { type: 'minerals', operator: '>=', value: 75 },
    ],
    action: { type: 'train', targetId: 'vanguard' },
    cooldownTicks: 35,
  },

  // === Unit Production - Special Units ===
  {
    id: 'train_operative',
    name: 'Train Operative',
    description: 'Build stealth sniper for intel and assassinations',
    priority: 45,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'research_module' },
      { type: 'plasma', operator: '>=', value: 100 },
      { type: 'minerals', operator: '>=', value: 125 },
      { type: 'armySupply', operator: '>=', value: 10 },
    ],
    action: { type: 'train', targetId: 'operative' },
    cooldownTicks: 60,
    difficulties: ['medium', 'hard', 'very_hard', 'insane'],
  },

  // === Unit Production - Support (Hangar) ===
  {
    id: 'train_lifter',
    name: 'Train Lifter',
    description: 'Build healer/transport for army sustain',
    priority: 41,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'hangar' },
      { type: 'plasma', operator: '>=', value: 75 },
      { type: 'minerals', operator: '>=', value: 75 },
      { type: 'armySupply', operator: '>=', value: 10 },
      { type: 'unitCount', operator: '<', value: 3, targetId: 'lifter' },
    ],
    action: { type: 'train', targetId: 'lifter' },
    cooldownTicks: 80,
    difficulties: ['medium', 'hard', 'very_hard', 'insane'],
  },

  {
    id: 'train_overseer',
    name: 'Train Overseer',
    description: 'Build detector to reveal cloaked enemies',
    priority: 39,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'hangar' },
      { type: 'plasma', operator: '>=', value: 150 },
      { type: 'minerals', operator: '>=', value: 75 },
      { type: 'unitCount', operator: '<', value: 2, targetId: 'overseer' },
    ],
    action: { type: 'train', targetId: 'overseer' },
    cooldownTicks: 120,
    difficulties: ['hard', 'very_hard', 'insane'],
  },

  // === Personality-Specific Rules ===
  // Aggressive: extra production buildings earlier
  {
    id: 'aggressive_extra_production',
    name: 'Aggressive Production Scaling',
    description: 'Aggressive AIs build more production earlier',
    priority: 72,
    conditions: [
      { type: 'workers', operator: '>=', value: 10 },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'buildingCount', operator: '<', value: 3, targetId: 'infantry_bay' },
      { type: 'minerals', operator: '>=', value: 150 },
    ],
    action: { type: 'build', targetId: 'infantry_bay' },
    cooldownTicks: 150,
    personalities: ['aggressive', 'cheese'],
  },

  // Economic: earlier expansion
  {
    id: 'economic_early_expand',
    name: 'Economic Early Expansion',
    description: 'Economic AIs expand earlier',
    priority: 62,
    conditions: [
      { type: 'workers', operator: '>=', value: 12 },
      { type: 'minerals', operator: '>=', value: 350 },
      { type: 'bases', operator: '<', value: 3 },
      { type: 'gameTime', operator: '>=', value: 1200 },
    ],
    action: { type: 'expand' },
    cooldownTicks: 500,
    personalities: ['economic'],
  },

  // Turtle: second hangar for air-heavy late game
  {
    id: 'turtle_second_hangar',
    name: 'Turtle Second Hangar',
    description: 'Turtle AIs build a second hangar for air army',
    priority: 56,
    conditions: [
      { type: 'buildingCount', operator: '==', value: 1, targetId: 'hangar' },
      { type: 'buildingCount', operator: '>=', value: 2, targetId: 'research_module' },
      { type: 'minerals', operator: '>=', value: 150 },
      { type: 'plasma', operator: '>=', value: 100 },
      { type: 'gameTime', operator: '>=', value: 3000 },
    ],
    action: { type: 'build', targetId: 'hangar' },
    cooldownTicks: 300,
    personalities: ['turtle', 'defensive'],
  },

  // === Mixed Army Production ===
  // Broader mixed production with slower cooldowns to allow resource accumulation for expensive units
  {
    id: 'train_mixed_army_with_vehicles',
    name: 'Mixed Army (With Vehicles)',
    description: 'Train diverse army when forge is available',
    priority: 47,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'forge' },
      { type: 'minerals', operator: '>=', value: 100 },
      { type: 'plasma', operator: '>=', value: 25 },
      { type: 'supplyRatio', operator: '<', value: 0.9 },
    ],
    action: {
      type: 'train',
      options: [
        { id: 'trooper', weight: 4 },
        { id: 'breacher', weight: 4 },
        { id: 'scorcher', weight: 5 },
        { id: 'devastator', weight: 4 },
        { id: 'vanguard', weight: 3 },
      ],
    },
    cooldownTicks: 30,
  },

  {
    id: 'train_mixed_army_with_air',
    name: 'Mixed Army (With Air)',
    description: 'Train diverse army when hangar is available',
    priority: 49,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'hangar' },
      { type: 'minerals', operator: '>=', value: 100 },
      { type: 'plasma', operator: '>=', value: 50 },
      { type: 'supplyRatio', operator: '<', value: 0.9 },
    ],
    action: {
      type: 'train',
      options: [
        { id: 'trooper', weight: 3 },
        { id: 'devastator', weight: 4 },
        { id: 'valkyrie', weight: 5 },
        { id: 'specter', weight: 3 },
        { id: 'colossus', weight: 2 },
        { id: 'dreadnought', weight: 1 },
      ],
    },
    cooldownTicks: 30,
  },

  {
    id: 'train_army_aggressive',
    name: 'Aggressive Infantry Production',
    description: 'Keep infantry production going',
    priority: 40,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'minerals', operator: '>=', value: 50 },
      { type: 'supplyRatio', operator: '<', value: 0.95 },
    ],
    action: {
      type: 'train',
      options: [
        { id: 'trooper', weight: 6 },
        { id: 'breacher', weight: 4 },
        { id: 'vanguard', weight: 4 },
        { id: 'operative', weight: 1 },
      ],
    },
    cooldownTicks: 18,
  },

  // Army production with vehicle variety when forge is available
  {
    id: 'train_army_with_forge',
    name: 'Army Production (With Forge)',
    description: 'Produce diverse army including vehicles when forge available',
    priority: 43,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'forge' },
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'minerals', operator: '>=', value: 75 },
      { type: 'supplyRatio', operator: '<', value: 0.95 },
    ],
    action: {
      type: 'train',
      options: [
        { id: 'trooper', weight: 4 },
        { id: 'breacher', weight: 4 },
        { id: 'scorcher', weight: 5 },
        { id: 'vanguard', weight: 3 },
        { id: 'devastator', weight: 2 },
      ],
    },
    cooldownTicks: 20,
  },

  {
    id: 'train_trooper',
    name: 'Train Trooper',
    description: 'Basic infantry fallback',
    priority: 30,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'minerals', operator: '>=', value: 50 },
      { type: 'supplyRatio', operator: '<', value: 0.95 },
    ],
    action: { type: 'train', targetId: 'trooper' },
    cooldownTicks: 22,
  },

  // === CATCHALL: Spend excess minerals ===
  {
    id: 'train_excess_minerals',
    name: 'Spend Excess Minerals',
    description: 'Dont float minerals - produce something!',
    priority: 25,
    conditions: [
      { type: 'buildingCount', operator: '>=', value: 1, targetId: 'infantry_bay' },
      { type: 'minerals', operator: '>=', value: 250 },
    ],
    action: {
      type: 'train',
      options: [
        { id: 'trooper', weight: 5 },
        { id: 'breacher', weight: 4 },
        { id: 'vanguard', weight: 3 },
        { id: 'scorcher', weight: 3 },
      ],
    },
    cooldownTicks: 12,
  },

  // === Expansion ===
  // Expand when resources are depleting (simulation-based economy trigger)
  {
    id: 'expand_depleted',
    name: 'Expand Due to Depletion',
    description: 'Resources are running out, need new base',
    priority: 65, // Higher priority than saturation-based
    conditions: [
      { type: 'depletedPatchesNearBases', operator: '>=', value: 3 }, // 3+ patches depleted
      { type: 'minerals', operator: '>=', value: 350 },
    ],
    action: { type: 'expand' },
    cooldownTicks: 600,
  },

  {
    id: 'expand_saturated',
    name: 'Expand When Saturated',
    description: 'Build new base when workers are saturated',
    priority: 60,
    conditions: [
      { type: 'workerSaturation', operator: '>=', value: 0.8 },
      { type: 'minerals', operator: '>=', value: 400 },
      { type: 'armySupply', operator: '>=', value: 4 },
    ],
    action: { type: 'expand' },
    cooldownTicks: 800,
  },

  // Time-based expansion fallback
  {
    id: 'expand_timed',
    name: 'Timed Expansion',
    description: 'Expand after game time even without saturation',
    priority: 55,
    conditions: [
      { type: 'gameTime', operator: '>=', value: 2000 }, // ~100 seconds
      { type: 'minerals', operator: '>=', value: 400 },
      { type: 'bases', operator: '<', value: 3 },
    ],
    action: { type: 'expand' },
    cooldownTicks: 1000,
    difficulties: ['medium', 'hard', 'very_hard', 'insane'],
  },
];

// ==================== COMPOSITION GOALS BY PERSONALITY ====================
// Each personality gets distinct army composition targets per game phase.
// Values are percentages (should sum to ~100 per phase).

const BALANCED_COMPOSITION_GOALS: CompositionGoal[] = [
  {
    timeRange: [0, 2000],
    composition: { trooper: 40, breacher: 25, vanguard: 20, scorcher: 15 },
    minArmySupply: 6,
  },
  {
    timeRange: [2000, 5000],
    composition: {
      trooper: 15,
      breacher: 15,
      scorcher: 15,
      devastator: 20,
      valkyrie: 15,
      colossus: 10,
      vanguard: 10,
    },
    minArmySupply: 15,
  },
  {
    timeRange: [5000, Infinity],
    composition: {
      devastator: 20,
      colossus: 20,
      valkyrie: 15,
      breacher: 10,
      trooper: 10,
      specter: 10,
      dreadnought: 10,
      operative: 5,
    },
    minArmySupply: 30,
  },
];

const AGGRESSIVE_COMPOSITION_GOALS: CompositionGoal[] = [
  {
    timeRange: [0, 1800],
    composition: { trooper: 30, scorcher: 25, vanguard: 25, breacher: 20 },
    minArmySupply: 4,
  },
  {
    timeRange: [1800, 4500],
    composition: {
      scorcher: 20,
      valkyrie: 20,
      trooper: 15,
      vanguard: 15,
      devastator: 15,
      breacher: 10,
      specter: 5,
    },
    minArmySupply: 12,
  },
  {
    timeRange: [4500, Infinity],
    composition: {
      valkyrie: 20,
      scorcher: 15,
      devastator: 15,
      specter: 15,
      vanguard: 10,
      trooper: 10,
      colossus: 10,
      operative: 5,
    },
    minArmySupply: 25,
  },
];

const DEFENSIVE_COMPOSITION_GOALS: CompositionGoal[] = [
  {
    timeRange: [0, 2200],
    composition: { trooper: 35, breacher: 30, devastator: 20, vanguard: 15 },
    minArmySupply: 6,
  },
  {
    timeRange: [2200, 5500],
    composition: {
      devastator: 25,
      breacher: 20,
      colossus: 20,
      trooper: 15,
      valkyrie: 10,
      scorcher: 10,
    },
    minArmySupply: 18,
  },
  {
    timeRange: [5500, Infinity],
    composition: {
      colossus: 25,
      devastator: 20,
      valkyrie: 15,
      breacher: 10,
      dreadnought: 10,
      trooper: 10,
      specter: 5,
      operative: 5,
    },
    minArmySupply: 30,
  },
];

const ECONOMIC_COMPOSITION_GOALS: CompositionGoal[] = [
  {
    timeRange: [0, 2500],
    composition: { trooper: 45, breacher: 30, vanguard: 15, scorcher: 10 },
    minArmySupply: 6,
  },
  {
    timeRange: [2500, 5000],
    composition: {
      colossus: 25,
      devastator: 20,
      valkyrie: 15,
      breacher: 15,
      trooper: 15,
      scorcher: 10,
    },
    minArmySupply: 15,
  },
  {
    timeRange: [5000, Infinity],
    composition: {
      dreadnought: 20,
      colossus: 20,
      devastator: 15,
      valkyrie: 15,
      specter: 10,
      breacher: 10,
      operative: 5,
      trooper: 5,
    },
    minArmySupply: 25,
  },
];

const CHEESE_COMPOSITION_GOALS: CompositionGoal[] = [
  {
    timeRange: [0, 1500],
    composition: { trooper: 45, vanguard: 30, scorcher: 25 },
    minArmySupply: 3,
  },
  {
    timeRange: [1500, 4000],
    composition: {
      scorcher: 25,
      trooper: 20,
      vanguard: 20,
      valkyrie: 15,
      breacher: 10,
      specter: 10,
    },
    minArmySupply: 10,
  },
  {
    timeRange: [4000, Infinity],
    composition: {
      valkyrie: 20,
      scorcher: 20,
      specter: 15,
      trooper: 15,
      vanguard: 10,
      operative: 10,
      devastator: 10,
    },
    minArmySupply: 20,
  },
];

const TURTLE_COMPOSITION_GOALS: CompositionGoal[] = [
  {
    timeRange: [0, 2500],
    composition: { trooper: 30, breacher: 30, devastator: 25, vanguard: 15 },
    minArmySupply: 8,
  },
  {
    timeRange: [2500, 6000],
    composition: {
      colossus: 25,
      devastator: 25,
      valkyrie: 15,
      breacher: 15,
      specter: 10,
      trooper: 10,
    },
    minArmySupply: 20,
  },
  {
    timeRange: [6000, Infinity],
    composition: {
      dreadnought: 25,
      colossus: 20,
      valkyrie: 15,
      specter: 15,
      devastator: 10,
      breacher: 10,
      operative: 5,
    },
    minArmySupply: 35,
  },
];

const PERSONALITY_COMPOSITION_GOALS: Partial<Record<AIPersonality, CompositionGoal[]>> = {
  aggressive: AGGRESSIVE_COMPOSITION_GOALS,
  defensive: DEFENSIVE_COMPOSITION_GOALS,
  economic: ECONOMIC_COMPOSITION_GOALS,
  balanced: BALANCED_COMPOSITION_GOALS,
  cheese: CHEESE_COMPOSITION_GOALS,
  turtle: TURTLE_COMPOSITION_GOALS,
};

// ==================== FACTION CONFIGURATION ====================

export const DOMINION_AI_CONFIG: FactionAIConfig = {
  factionId: 'dominion',
  factionName: 'Dominion',

  // === Unit Role Mappings ===
  roles: {
    worker: 'fabricator',
    mainBase: 'headquarters',
    supplyBuilding: 'supply_cache',
    gasExtractor: 'extractor',
    basicProduction: 'infantry_bay',
    basicUnit: 'trooper',
    scout: 'trooper',
    antiAir: ['trooper', 'valkyrie', 'colossus', 'specter', 'breacher'],
    siege: ['devastator', 'colossus', 'dreadnought'],
    harass: ['scorcher', 'vanguard', 'valkyrie'],
    baseTypes: ['headquarters', 'orbital_station', 'bastion'],
  },

  // === Difficulty Settings ===
  difficultyConfig: {
    easy: {
      actionDelayTicks: 60, // 3 seconds
      targetWorkers: 16,
      maxBases: 2,
      miningSpeedMultiplier: 1.0, // Normal mining speed
      buildSpeedMultiplier: 1.0,
      scoutingEnabled: false,
      counterBuildingEnabled: false,
      microEnabled: false,
      harassmentEnabled: false,
      expansionCooldown: 600, // Lowered - expand more often
      attackCooldown: 200, // Lowered - attack every 10 seconds
      scoutCooldown: 0,
      harassCooldown: 0,
      minWorkersForExpansion: 14,
      minArmyForExpansion: 8,
    },
    medium: {
      actionDelayTicks: 40, // 2 seconds
      targetWorkers: 22,
      maxBases: 3,
      miningSpeedMultiplier: 1.0, // Normal mining speed
      buildSpeedMultiplier: 1.0,
      scoutingEnabled: true,
      counterBuildingEnabled: false,
      microEnabled: false,
      harassmentEnabled: false,
      expansionCooldown: 500, // Lowered
      attackCooldown: 150, // Lowered - attack every 7.5 seconds
      scoutCooldown: 400,
      harassCooldown: 0,
      minWorkersForExpansion: 12,
      minArmyForExpansion: 6,
    },
    hard: {
      actionDelayTicks: 20, // 1 second
      targetWorkers: 28,
      maxBases: 4,
      miningSpeedMultiplier: 1.0, // Normal mining speed
      buildSpeedMultiplier: 1.0,
      scoutingEnabled: true,
      counterBuildingEnabled: true,
      microEnabled: true,
      harassmentEnabled: true,
      expansionCooldown: 400, // Lowered
      attackCooldown: 100, // Lowered - attack every 5 seconds
      scoutCooldown: 300,
      harassCooldown: 300,
      minWorkersForExpansion: 8,
      minArmyForExpansion: 2,
    },
    very_hard: {
      actionDelayTicks: 15,
      targetWorkers: 32,
      maxBases: 5,
      miningSpeedMultiplier: 1.25,
      buildSpeedMultiplier: 1.1,
      scoutingEnabled: true,
      counterBuildingEnabled: true,
      microEnabled: true,
      harassmentEnabled: true,
      expansionCooldown: 350, // Lowered
      attackCooldown: 80, // Lowered - attack every 4 seconds
      scoutCooldown: 200,
      harassCooldown: 200,
      minWorkersForExpansion: 6,
      minArmyForExpansion: 0,
    },
    insane: {
      actionDelayTicks: 10,
      targetWorkers: 40,
      maxBases: 6,
      miningSpeedMultiplier: 1.5,
      buildSpeedMultiplier: 1.3,
      scoutingEnabled: true,
      counterBuildingEnabled: true,
      microEnabled: true,
      harassmentEnabled: true,
      expansionCooldown: 250, // Lowered
      attackCooldown: 40, // Lowered - attack every 2 seconds
      scoutCooldown: 150,
      harassCooldown: 150,
      minWorkersForExpansion: 4,
      minArmyForExpansion: 0,
    },
  },

  // === Economy Configuration ===
  // Note: AI now uses real simulation-based economy (no passive income)
  // Mining speed bonuses are in difficultyConfig.miningSpeedMultiplier
  economy: {
    optimalWorkersPerMineral: 2,
    optimalWorkersPerGas: 3,
    optimalWorkersPerBase: 16, // 16 is optimal (2 per patch * 8 patches)
    supplyPerMainBase: 11,
    supplyPerSupplyBuilding: 8,
    supplyBuildBuffer: 4, // FIX: Build supply when within 4 of max (was 2)
    expansionMineralThreshold: 400,
    saturationExpansionRatio: 0.8,
  },

  // === Production Scaling ===
  // FIX: Dynamic scaling instead of hardcoded limits
  production: {
    buildings: [
      {
        buildingId: 'infantry_bay',
        firstAt: 10, // Workers needed for first
        additionalEvery: 8, // Additional workers for each subsequent
        maxPerBase: 2,
        maxTotal: 6, // FIX: Was hardcoded at 2!
      },
      {
        buildingId: 'forge',
        firstAt: 14,
        additionalEvery: 12,
        maxPerBase: 1,
        maxTotal: 3,
        requires: ['infantry_bay', 'extractor'],
        minPlasma: 100,
      },
      {
        buildingId: 'hangar',
        firstAt: 18,
        additionalEvery: 15,
        maxPerBase: 1,
        maxTotal: 2,
        requires: ['forge'],
        minPlasma: 100,
      },
    ],
    researchModulePriority: ['forge', 'infantry_bay', 'hangar'],
    maxResearchModules: 3,
  },

  // === Macro Rules ===
  macroRules: DOMINION_MACRO_RULES,

  // === Tactical Configuration ===
  tactical: {
    // Unit priorities for focus fire (higher = kill first)
    unitPriorities: {
      // Heavy threats - kill first
      dreadnought: 100,
      colossus: 95,
      devastator: 90,
      // Support units - high priority
      lifter: 85,
      operative: 80, // Stealth/sniper
      // Air units
      specter: 78,
      valkyrie: 75,
      // Ground damage dealers
      inferno: 70,
      breacher: 65,
      trooper: 60,
      vanguard: 55,
      scorcher: 50,
      // Workers - lowest priority
      fabricator: 10,
    },

    // Counter-unit relationships
    counterMatrix: {
      trooper: ['scorcher', 'inferno', 'devastator'],
      breacher: ['trooper', 'scorcher', 'valkyrie'],
      vanguard: ['trooper', 'valkyrie'],
      scorcher: ['devastator', 'colossus', 'breacher'],
      inferno: ['devastator', 'colossus'],
      devastator: ['valkyrie', 'specter', 'breacher'],
      colossus: ['trooper', 'breacher', 'devastator'],
      valkyrie: ['trooper', 'colossus'],
      specter: ['trooper', 'valkyrie'],
      lifter: ['valkyrie', 'trooper'],
      dreadnought: ['breacher', 'devastator', 'specter'],
      operative: ['scorcher', 'valkyrie', 'overseer'],
      stingray: ['corsair', 'valkyrie'],
      corsair: ['stingray', 'trooper'],
      leviathan: ['valkyrie', 'specter', 'corsair'],
    },

    // Threat assessment weights
    threatWeights: {
      damage: 1.0,
      priority: 0.8,
      distance: 1.2,
      health: 0.5,
      aggression: 1.5,
    },

    // Default composition goals (fallback when no personality-specific goals exist)
    compositionGoals: BALANCED_COMPOSITION_GOALS,

    // Personality-specific composition goals for varied strategies
    personalityCompositionGoals: PERSONALITY_COMPOSITION_GOALS,

    // Attack thresholds by difficulty
    attackThresholds: {
      easy: 15,
      medium: 12,
      hard: 10,
      very_hard: 8,
      insane: 6,
    },

    // Defense ratio (keep this % of army for defense)
    defenseRatio: {
      easy: 0.5,
      medium: 0.4,
      hard: 0.3,
      very_hard: 0.25,
      insane: 0.2,
    },

    // Harass units
    harassUnits: ['scorcher', 'vanguard', 'valkyrie', 'specter'],

    // Scout unit
    scoutUnit: 'trooper',
  },

  // === Micro Configuration ===
  micro: {
    global: {
      updateInterval: 8, // Ticks between micro updates
      threatUpdateInterval: 10,
      scanRange: 15,
      focusFireThreshold: 0.7, // Switch target if current is above 70% health
    },

    unitBehaviors: {
      // Trooper - basic infantry, no special micro
      trooper: {
        kiting: false,
        retreatThreshold: 0.2,
        focusFire: true,
        focusFireThreshold: 0.7,
      },

      // Breacher - ranged anti-armor, kites from melee
      breacher: {
        kiting: {
          enabled: true,
          distance: 3,
          cooldownTicks: 10,
          kiteFrom: ['scorcher', 'inferno', 'trooper'],
        },
        retreatThreshold: 0.25,
        focusFire: true,
        focusFireThreshold: 0.6,
        preferredRange: 5,
      },

      // Vanguard - jetpack, very mobile
      vanguard: {
        kiting: {
          enabled: true,
          distance: 4,
          cooldownTicks: 8,
        },
        retreatThreshold: 0.3,
        focusFire: true,
        focusFireThreshold: 0.7,
      },

      // Scorcher - fast vehicle, transforms to inferno for close-range AoE
      scorcher: {
        kiting: {
          enabled: true,
          distance: 5,
          cooldownTicks: 12,
        },
        retreatThreshold: 0.3,
        focusFire: false,
        focusFireThreshold: 0.7,
        transformLogic: {
          modeA: {
            name: 'inferno',
            conditions: [{ type: 'enemyArmyStrength', operator: '>', value: 0 }],
          },
          modeB: {
            name: 'scorcher',
            conditions: [{ type: 'enemyArmyStrength', operator: '==', value: 0 }],
          },
        },
      },

      // Devastator - siege tank, hold position
      devastator: {
        kiting: false, // Too slow to kite
        retreatThreshold: 0.15, // Stay in fight longer
        focusFire: true,
        focusFireThreshold: 0.5,
        preferredRange: 7,
      },

      // Colossus - heavy tank, very durable
      colossus: {
        kiting: false,
        retreatThreshold: 0.1, // Very low - tank should tank
        focusFire: true,
        focusFireThreshold: 0.4,
      },

      // Valkyrie - transformable air unit
      valkyrie: {
        kiting: {
          enabled: true,
          distance: 4,
          cooldownTicks: 10,
        },
        retreatThreshold: 0.25,
        focusFire: true,
        focusFireThreshold: 0.6,
        transformLogic: {
          modeA: {
            name: 'fighter',
            conditions: [{ type: 'enemyAirUnits', operator: '>', value: 0 }],
          },
          modeB: {
            name: 'assault',
            conditions: [{ type: 'enemyAirUnits', operator: '==', value: 0 }],
          },
        },
      },

      // Specter - cloaked air unit
      specter: {
        kiting: {
          enabled: true,
          distance: 5,
          cooldownTicks: 8,
        },
        retreatThreshold: 0.3,
        focusFire: true,
        focusFireThreshold: 0.5,
      },

      // Lifter - support/transport
      lifter: {
        kiting: {
          enabled: true,
          distance: 6,
          cooldownTicks: 10,
        },
        retreatThreshold: 0.4, // Retreat early - valuable support
        focusFire: false,
        focusFireThreshold: 0.7,
      },

      // Operative - stealth sniper
      operative: {
        kiting: {
          enabled: true,
          distance: 6,
          cooldownTicks: 8,
        },
        retreatThreshold: 0.35,
        focusFire: true,
        focusFireThreshold: 0.4,
        preferredRange: 8,
      },

      // Dreadnought - capital ship, very durable
      dreadnought: {
        kiting: false,
        retreatThreshold: 0.1,
        focusFire: true,
        focusFireThreshold: 0.3,
      },

      // Overseer - detector, stay safe
      overseer: {
        kiting: {
          enabled: true,
          distance: 8,
          cooldownTicks: 10,
        },
        retreatThreshold: 0.5,
        focusFire: false,
        focusFireThreshold: 0.7,
      },
    },
  },

  // Reference to build orders in buildOrders.ts
  buildOrdersRef: 'dominion',
};

// ==================== REGISTER CONFIGURATION ====================

// Auto-register when this module is imported
registerFactionAIConfig(DOMINION_AI_CONFIG);

// Export for direct access
export default DOMINION_AI_CONFIG;

import { Component } from '../ecs/Component';

export type AbilityTargetType = 'none' | 'point' | 'unit' | 'ally' | 'self';

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  cooldown: number; // seconds
  energyCost: number;
  range: number; // 0 for self-cast or instant
  targetType: AbilityTargetType;
  hotkey: string;
  iconId?: string;
  // Effect parameters
  damage?: number;
  healing?: number;
  duration?: number;
  aoeRadius?: number;
  buffId?: string;
}

export interface AbilityState {
  definition: AbilityDefinition;
  currentCooldown: number; // remaining cooldown in seconds
  isActive: boolean; // for toggle abilities
}

export class Ability extends Component {
  public readonly type = 'Ability';

  public abilities: Map<string, AbilityState> = new Map();
  public energy: number;
  public maxEnergy: number;
  public energyRegen: number; // per second

  constructor(
    maxEnergy: number = 0,
    energyRegen: number = 0,
    abilities: AbilityDefinition[] = []
  ) {
    super();
    this.energy = maxEnergy;
    this.maxEnergy = maxEnergy;
    this.energyRegen = energyRegen;

    for (const def of abilities) {
      this.abilities.set(def.id, {
        definition: def,
        currentCooldown: 0,
        isActive: false,
      });
    }
  }

  public addAbility(definition: AbilityDefinition): void {
    this.abilities.set(definition.id, {
      definition,
      currentCooldown: 0,
      isActive: false,
    });
  }

  public removeAbility(abilityId: string): void {
    this.abilities.delete(abilityId);
  }

  public canUseAbility(abilityId: string): boolean {
    const ability = this.abilities.get(abilityId);
    if (!ability) return false;

    return (
      ability.currentCooldown <= 0 &&
      this.energy >= ability.definition.energyCost
    );
  }

  public useAbility(abilityId: string): boolean {
    const ability = this.abilities.get(abilityId);
    if (!ability || !this.canUseAbility(abilityId)) return false;

    // Consume energy and start cooldown
    this.energy -= ability.definition.energyCost;
    ability.currentCooldown = ability.definition.cooldown;

    return true;
  }

  public updateCooldowns(deltaTime: number): void {
    // Regenerate energy
    if (this.maxEnergy > 0) {
      this.energy = Math.min(this.maxEnergy, this.energy + this.energyRegen * deltaTime);
    }

    // Update cooldowns
    for (const ability of this.abilities.values()) {
      if (ability.currentCooldown > 0) {
        ability.currentCooldown = Math.max(0, ability.currentCooldown - deltaTime);
      }
    }
  }

  public getAbility(abilityId: string): AbilityState | undefined {
    return this.abilities.get(abilityId);
  }

  public getAbilityList(): AbilityState[] {
    return Array.from(this.abilities.values());
  }

  public getCooldownPercent(abilityId: string): number {
    const ability = this.abilities.get(abilityId);
    if (!ability) return 0;
    if (ability.definition.cooldown === 0) return 0;
    return ability.currentCooldown / ability.definition.cooldown;
  }
}

// Predefined abilities for Dominion faction
export const DOMINION_ABILITIES: Record<string, AbilityDefinition> = {
  stim_pack: {
    id: 'stim_pack',
    name: 'Stim Pack',
    description: 'Temporarily increases attack and movement speed at the cost of HP',
    cooldown: 10,
    energyCost: 0,
    range: 0,
    targetType: 'self',
    hotkey: 'T',
    duration: 10,
    damage: 10, // HP cost
  },
  combat_shield: {
    id: 'combat_shield',
    name: 'Combat Shield',
    description: 'Increases max HP by 10',
    cooldown: 0, // Passive upgrade
    energyCost: 0,
    range: 0,
    targetType: 'none',
    hotkey: 'C',
    healing: 10,
  },
  siege_mode: {
    id: 'siege_mode',
    name: 'Siege Mode',
    description: 'Transform into siege mode for increased range and damage',
    cooldown: 3,
    energyCost: 0,
    range: 0,
    targetType: 'self',
    hotkey: 'E',
  },
  emp_round: {
    id: 'emp_round',
    name: 'EMP Round',
    description: 'Drains energy and shields from enemy units in area',
    cooldown: 60,
    energyCost: 75,
    range: 10,
    targetType: 'point',
    hotkey: 'E',
    aoeRadius: 2.5,
  },
  snipe: {
    id: 'snipe',
    name: 'Snipe',
    description: 'Deal 150 damage to a biological unit',
    cooldown: 0,
    energyCost: 25,
    range: 10,
    targetType: 'unit',
    hotkey: 'R',
    damage: 150,
  },
  nuke: {
    id: 'nuke',
    name: 'Nuclear Strike',
    description: 'Call down a nuclear strike on target location',
    cooldown: 180,
    energyCost: 0,
    range: 8,
    targetType: 'point',
    hotkey: 'N',
    damage: 300,
    aoeRadius: 8,
  },
  scanner_sweep: {
    id: 'scanner_sweep',
    name: 'Scanner Sweep',
    description: 'Reveal an area and detect cloaked units',
    cooldown: 50,
    energyCost: 50,
    range: 0,
    targetType: 'point',
    hotkey: 'V',
    aoeRadius: 8,
    duration: 15,
  },
  mule: {
    id: 'mule',
    name: 'Calldown: MULE',
    description: 'Drop a MULE to accelerate mineral gathering',
    cooldown: 50,
    energyCost: 50,
    range: 0,
    targetType: 'point',
    hotkey: 'E',
    duration: 64,
  },
  supply_drop: {
    id: 'supply_drop',
    name: 'Calldown: Extra Supplies',
    description: 'Instantly complete a Supply Depot under construction',
    cooldown: 50,
    energyCost: 50,
    range: 0,
    targetType: 'unit',
    hotkey: 'D',
  },
};

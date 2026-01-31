import { Component } from '../ecs/Component';
import { DefinitionRegistry } from '../definitions/DefinitionRegistry';

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

/**
 * Dominion Abilities
 *
 * This is a proxy object that delegates to the DefinitionRegistry.
 * The source of truth is: public/data/factions/dominion/abilities.json
 */
export const DOMINION_ABILITIES: Record<string, AbilityDefinition> = new Proxy(
  {} as Record<string, AbilityDefinition>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[DOMINION_ABILITIES] Accessing '${prop}' before definitions initialized`);
        return undefined;
      }
      return DefinitionRegistry.getAbility(prop) as AbilityDefinition | undefined;
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      return DefinitionRegistry.getAbility(prop) !== undefined;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getAllAbilities());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const ability = DefinitionRegistry.getAbility(prop);
      if (!ability) return undefined;
      return {
        value: ability as AbilityDefinition,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

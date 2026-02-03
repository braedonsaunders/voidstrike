/**
 * Buff Mixin
 *
 * Provides buff/debuff tracking and effect calculation for units.
 * Buffs are temporary stat modifiers with duration-based expiration.
 */

import type { Constructor, BuffData, UnitDefinition } from './types';

/**
 * Interface for buff-related properties
 */
export interface BuffFields {
  activeBuffs: Map<string, BuffData>;
}

/**
 * Interface for base class requirements.
 * Only requires properties that exist on UnitCore.
 * Combat properties are accessed via optional typing since they come from CombatMixin.
 */
export interface BuffBase {
  speed: number;
  attackSpeed?: number;
  attackDamage?: number;
}

/**
 * Mixin that adds buff/debuff functionality to a unit
 */
export function BuffMixin<TBase extends Constructor<BuffBase>>(Base: TBase) {
  return class WithBuff extends Base implements BuffFields {
    public activeBuffs: Map<string, BuffData> = new Map();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      this.activeBuffs = new Map();
    }

    /**
     * Apply a buff with specified duration and effects
     */
    public applyBuff(buffId: string, duration: number, effects: Record<string, number>): void {
      this.activeBuffs.set(buffId, { duration, effects });
    }

    /**
     * Remove a buff by ID
     */
    public removeBuff(buffId: string): void {
      this.activeBuffs.delete(buffId);
    }

    /**
     * Check if unit has a specific buff
     */
    public hasBuff(buffId: string): boolean {
      return this.activeBuffs.has(buffId);
    }

    /**
     * Get total effect value for a specific effect name across all buffs
     */
    public getBuffEffect(effectName: string): number {
      let totalEffect = 0;
      for (const buff of this.activeBuffs.values()) {
        if (buff.effects[effectName]) {
          totalEffect += buff.effects[effectName];
        }
      }
      return totalEffect;
    }

    /**
     * Update buff durations and return list of expired buff IDs
     */
    public updateBuffs(deltaTime: number): string[] {
      const expiredBuffs: string[] = [];
      for (const [buffId, buff] of this.activeBuffs) {
        buff.duration -= deltaTime;
        if (buff.duration <= 0) {
          expiredBuffs.push(buffId);
        }
      }
      for (const buffId of expiredBuffs) {
        this.activeBuffs.delete(buffId);
      }
      return expiredBuffs;
    }

    /**
     * Get effective speed including buff modifiers
     */
    public getEffectiveSpeed(): number {
      const speedBonus = this.getBuffEffect('moveSpeedBonus');
      return this.speed * (1 + speedBonus);
    }

    /**
     * Get effective attack speed including buff modifiers
     */
    public getEffectiveAttackSpeed(): number {
      const attackSpeedBonus = this.getBuffEffect('attackSpeedBonus');
      const baseAttackSpeed = this.attackSpeed ?? 1;
      return baseAttackSpeed * (1 + attackSpeedBonus);
    }

    /**
     * Get effective damage including buff modifiers
     */
    public getEffectiveDamage(): number {
      const damageBonus = this.getBuffEffect('damageBonus');
      const baseDamage = this.attackDamage ?? 0;
      return baseDamage * (1 + damageBonus);
    }

    /**
     * Initialize buff fields from definition (called by composed class)
     */
    protected initializeBuffFields(_definition: UnitDefinition): void {
      this.activeBuffs = new Map();
    }
  };
}

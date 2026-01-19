import { Component } from '../ecs/Component';

export type ArmorType = 'light' | 'armored' | 'massive' | 'structure';

export class Health extends Component {
  public readonly type = 'Health';

  public current: number;
  public max: number;
  public armor: number;
  public armorType: ArmorType;
  public regeneration: number; // HP per second

  // Shield (Synthesis units)
  public shield: number;
  public maxShield: number;
  public shieldRegeneration: number;
  public shieldRegenDelay: number; // Seconds before regen starts
  private lastDamageTime: number;

  constructor(
    max: number,
    armor = 0,
    armorType: ArmorType = 'light',
    regeneration = 0,
    maxShield = 0,
    shieldRegeneration = 0,
    shieldRegenDelay = 5
  ) {
    super();
    this.max = max;
    this.current = max;
    this.armor = armor;
    this.armorType = armorType;
    this.regeneration = regeneration;
    this.maxShield = maxShield;
    this.shield = maxShield;
    this.shieldRegeneration = shieldRegeneration;
    this.shieldRegenDelay = shieldRegenDelay;
    this.lastDamageTime = 0;
  }

  public takeDamage(amount: number, gameTime: number): number {
    this.lastDamageTime = gameTime;

    // Apply armor reduction
    const reducedDamage = Math.max(1, amount - this.armor);

    // Damage shield first
    if (this.shield > 0) {
      if (this.shield >= reducedDamage) {
        this.shield -= reducedDamage;
        return reducedDamage;
      } else {
        const overflow = reducedDamage - this.shield;
        this.shield = 0;
        this.current -= overflow;
      }
    } else {
      this.current -= reducedDamage;
    }

    this.current = Math.max(0, this.current);
    return reducedDamage;
  }

  /**
   * Apply damage directly without armor reduction.
   * Used when damage has already been calculated with armor factored in (e.g., projectile impacts).
   */
  public applyDamageRaw(amount: number, gameTime: number): number {
    this.lastDamageTime = gameTime;

    const damage = Math.max(1, amount);

    // Damage shield first
    if (this.shield > 0) {
      if (this.shield >= damage) {
        this.shield -= damage;
        return damage;
      } else {
        const overflow = damage - this.shield;
        this.shield = 0;
        this.current -= overflow;
      }
    } else {
      this.current -= damage;
    }

    this.current = Math.max(0, this.current);
    return damage;
  }

  public heal(amount: number): number {
    const actualHeal = Math.min(amount, this.max - this.current);
    this.current += actualHeal;
    return actualHeal;
  }

  public regenerate(deltaTime: number, gameTime: number): void {
    // Health regeneration
    if (this.regeneration > 0 && this.current < this.max) {
      this.current = Math.min(this.max, this.current + this.regeneration * deltaTime);
    }

    // Shield regeneration (with delay after taking damage)
    if (
      this.shieldRegeneration > 0 &&
      this.shield < this.maxShield &&
      gameTime - this.lastDamageTime >= this.shieldRegenDelay
    ) {
      this.shield = Math.min(
        this.maxShield,
        this.shield + this.shieldRegeneration * deltaTime
      );
    }
  }

  public isDead(): boolean {
    return this.current <= 0;
  }

  public getHealthPercent(): number {
    return this.current / this.max;
  }

  public getShieldPercent(): number {
    return this.maxShield > 0 ? this.shield / this.maxShield : 0;
  }

  public getTotalHealthPercent(): number {
    const totalMax = this.max + this.maxShield;
    const totalCurrent = this.current + this.shield;
    return totalCurrent / totalMax;
  }
}

/**
 * Definition Validator
 *
 * Runtime validation for game definitions loaded from JSON.
 * Ensures type safety and referential integrity.
 */

import type {
  UnitDefinition,
  BuildingDefinition,
  ResearchDefinition,
  AbilityDefinition,
  AbilityTargetType,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  TransformMode,
} from './types';

type DamageType = 'normal' | 'explosive' | 'concussive' | 'psionic';

const VALID_DAMAGE_TYPES: DamageType[] = ['normal', 'explosive', 'concussive', 'psionic'];
// AbilityTargetType imported from engine layer - these are the valid target types
const VALID_TARGET_TYPES: AbilityTargetType[] = ['none', 'point', 'unit', 'ally', 'self'];
const VALID_UNIT_CATEGORIES = ['infantry', 'vehicle', 'ship', 'naval'] as const;
const VALID_UPGRADE_EFFECT_TYPES = [
  'damage_bonus',
  'armor_bonus',
  'attack_speed',
  'ability_unlock',
  'range_bonus',
  'health_bonus',
  'speed_bonus',
] as const;

export class DefinitionValidator {
  private errors: ValidationError[] = [];
  private warnings: ValidationWarning[] = [];

  /**
   * Validate a game manifest
   */
  public validateGameManifest(manifest: unknown): ValidationResult {
    this.reset();
    const path = 'GameManifest';

    if (!this.isObject(manifest, path)) {
      return this.result();
    }

    const m = manifest as Record<string, unknown>;

    this.requireString(m.name, `${path}.name`);
    this.requireString(m.version, `${path}.version`);
    this.optionalString(m.description, `${path}.description`);

    if (!Array.isArray(m.factions)) {
      this.addError('invalid_type', `${path}.factions`, 'Must be an array of faction paths');
    } else if (m.factions.length === 0) {
      this.addError('missing_required', `${path}.factions`, 'At least one faction is required');
    } else {
      for (let i = 0; i < m.factions.length; i++) {
        this.requireString(m.factions[i], `${path}.factions[${i}]`);
      }
    }

    this.optionalString(m.defaultFaction, `${path}.defaultFaction`);

    return this.result();
  }

  /**
   * Validate a faction manifest
   */
  public validateFactionManifest(manifest: unknown): ValidationResult {
    this.reset();
    const path = 'FactionManifest';

    if (!this.isObject(manifest, path)) {
      return this.result();
    }

    const m = manifest as Record<string, unknown>;

    this.requireString(m.id, `${path}.id`);
    this.requireString(m.name, `${path}.name`);
    this.requireString(m.description, `${path}.description`);
    this.requireString(m.color, `${path}.color`);
    this.optionalString(m.icon, `${path}.icon`);

    this.requireString(m.unitsFile, `${path}.unitsFile`);
    this.requireString(m.buildingsFile, `${path}.buildingsFile`);
    this.requireString(m.researchFile, `${path}.researchFile`);
    this.requireString(m.abilitiesFile, `${path}.abilitiesFile`);

    this.optionalString(m.wallsFile, `${path}.wallsFile`);
    this.optionalString(m.wallUpgradesFile, `${path}.wallUpgradesFile`);

    return this.result();
  }

  /**
   * Validate a unit definition
   */
  public validateUnitDefinition(unit: unknown, id: string): ValidationResult {
    this.reset();
    const path = `Unit[${id}]`;

    if (!this.isObject(unit, path)) {
      return this.result();
    }

    const u = unit as Record<string, unknown>;

    // Required fields
    this.requireString(u.id, `${path}.id`);
    this.requireString(u.name, `${path}.name`);
    this.requireString(u.faction, `${path}.faction`);
    this.requireNumber(u.mineralCost, `${path}.mineralCost`, 0);
    this.requireNumber(u.vespeneCost, `${path}.vespeneCost`, 0);
    this.requireNumber(u.buildTime, `${path}.buildTime`, 0);
    this.requireNumber(u.supplyCost, `${path}.supplyCost`, 0);
    this.requireNumber(u.speed, `${path}.speed`, 0);
    this.requireNumber(u.sightRange, `${path}.sightRange`, 0);
    this.requireNumber(u.attackRange, `${path}.attackRange`, 0);
    this.requireNumber(u.attackDamage, `${path}.attackDamage`, 0);
    this.requireNumber(u.attackSpeed, `${path}.attackSpeed`, 0);
    this.requireNumber(u.maxHealth, `${path}.maxHealth`, 1);
    this.requireNumber(u.armor, `${path}.armor`, 0);

    if (!VALID_DAMAGE_TYPES.includes(u.damageType as DamageType)) {
      this.addError(
        'invalid_type',
        `${path}.damageType`,
        `Must be one of: ${VALID_DAMAGE_TYPES.join(', ')}`,
        u.damageType
      );
    }

    // Optional fields
    this.optionalString(u.description, `${path}.description`);
    this.optionalBoolean(u.isWorker, `${path}.isWorker`);
    this.optionalBoolean(u.isFlying, `${path}.isFlying`);
    this.optionalBoolean(u.isBiological, `${path}.isBiological`);
    this.optionalBoolean(u.isMechanical, `${path}.isMechanical`);
    this.optionalBoolean(u.canCloak, `${path}.canCloak`);
    this.optionalBoolean(u.isTransport, `${path}.isTransport`);
    this.optionalBoolean(u.isDetector, `${path}.isDetector`);
    this.optionalBoolean(u.canHeal, `${path}.canHeal`);
    this.optionalBoolean(u.canRepair, `${path}.canRepair`);
    this.optionalBoolean(u.canTransform, `${path}.canTransform`);
    this.optionalBoolean(u.canAttackGround, `${path}.canAttackGround`);
    this.optionalBoolean(u.canAttackAir, `${path}.canAttackAir`);

    this.optionalNumber(u.acceleration, `${path}.acceleration`, 0);
    this.optionalNumber(u.splashRadius, `${path}.splashRadius`, 0);
    this.optionalNumber(u.cloakEnergyCost, `${path}.cloakEnergyCost`, 0);
    this.optionalNumber(u.transportCapacity, `${path}.transportCapacity`, 0);
    this.optionalNumber(u.detectionRange, `${path}.detectionRange`, 0);
    this.optionalNumber(u.healRange, `${path}.healRange`, 0);
    this.optionalNumber(u.healRate, `${path}.healRate`, 0);
    this.optionalNumber(u.healEnergyCost, `${path}.healEnergyCost`, 0);

    this.optionalStringArray(u.abilities, `${path}.abilities`);

    // Transform modes
    if (u.canTransform && u.transformModes) {
      this.validateTransformModes(u.transformModes, path);
      this.optionalString(u.defaultMode, `${path}.defaultMode`);
    }

    // ID consistency check
    if (u.id !== id) {
      this.addWarning(
        'deprecated_field',
        `${path}.id`,
        `Unit ID '${u.id}' does not match key '${id}'`
      );
    }

    return this.result();
  }

  /**
   * Validate transform modes array
   */
  private validateTransformModes(modes: unknown, parentPath: string): void {
    const path = `${parentPath}.transformModes`;

    if (!Array.isArray(modes)) {
      this.addError('invalid_type', path, 'Must be an array of transform modes');
      return;
    }

    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      const modePath = `${path}[${i}]`;

      if (!this.isObject(mode, modePath)) continue;

      const m = mode as Record<string, unknown>;

      this.requireString(m.id, `${modePath}.id`);
      this.requireString(m.name, `${modePath}.name`);
      this.requireNumber(m.speed, `${modePath}.speed`, 0);
      this.requireNumber(m.attackRange, `${modePath}.attackRange`, 0);
      this.requireNumber(m.attackDamage, `${modePath}.attackDamage`, 0);
      this.requireNumber(m.attackSpeed, `${modePath}.attackSpeed`, 0);
      this.requireNumber(m.sightRange, `${modePath}.sightRange`, 0);
      this.requireNumber(m.transformTime, `${modePath}.transformTime`, 0);
      this.requireBoolean(m.canMove, `${modePath}.canMove`);

      this.optionalNumber(m.splashRadius, `${modePath}.splashRadius`, 0);
      this.optionalBoolean(m.isFlying, `${modePath}.isFlying`);
      this.optionalBoolean(m.canAttackGround, `${modePath}.canAttackGround`);
      this.optionalBoolean(m.canAttackAir, `${modePath}.canAttackAir`);
    }
  }

  /**
   * Validate a building definition
   */
  public validateBuildingDefinition(building: unknown, id: string): ValidationResult {
    this.reset();
    const path = `Building[${id}]`;

    if (!this.isObject(building, path)) {
      return this.result();
    }

    const b = building as Record<string, unknown>;

    // Required fields
    this.requireString(b.id, `${path}.id`);
    this.requireString(b.name, `${path}.name`);
    this.requireString(b.faction, `${path}.faction`);
    this.requireNumber(b.mineralCost, `${path}.mineralCost`, 0);
    this.requireNumber(b.vespeneCost, `${path}.vespeneCost`, 0);
    this.requireNumber(b.buildTime, `${path}.buildTime`, 0);
    this.requireNumber(b.width, `${path}.width`, 1);
    this.requireNumber(b.height, `${path}.height`, 1);
    this.requireNumber(b.maxHealth, `${path}.maxHealth`, 1);
    this.requireNumber(b.armor, `${path}.armor`, 0);
    this.requireNumber(b.sightRange, `${path}.sightRange`, 0);

    // Optional fields
    this.optionalString(b.description, `${path}.description`);
    this.optionalNumber(b.supplyProvided, `${path}.supplyProvided`, 0);
    this.optionalBoolean(b.canLiftOff, `${path}.canLiftOff`);
    this.optionalBoolean(b.canHaveAddon, `${path}.canHaveAddon`);
    this.optionalBoolean(b.isAddon, `${path}.isAddon`);
    this.optionalBoolean(b.isBunker, `${path}.isBunker`);
    this.optionalBoolean(b.canLower, `${path}.canLower`);
    this.optionalBoolean(b.isDetector, `${path}.isDetector`);

    this.optionalNumber(b.bunkerCapacity, `${path}.bunkerCapacity`, 0);
    this.optionalNumber(b.detectionRange, `${path}.detectionRange`, 0);
    this.optionalNumber(b.attackRange, `${path}.attackRange`, 0);
    this.optionalNumber(b.attackDamage, `${path}.attackDamage`, 0);
    this.optionalNumber(b.attackSpeed, `${path}.attackSpeed`, 0);

    this.optionalStringArray(b.canProduce, `${path}.canProduce`);
    this.optionalStringArray(b.canResearch, `${path}.canResearch`);
    this.optionalStringArray(b.requirements, `${path}.requirements`);
    this.optionalStringArray(b.addonFor, `${path}.addonFor`);
    this.optionalStringArray(b.canUpgradeTo, `${path}.canUpgradeTo`);

    // ID consistency check
    if (b.id !== id) {
      this.addWarning(
        'deprecated_field',
        `${path}.id`,
        `Building ID '${b.id}' does not match key '${id}'`
      );
    }

    return this.result();
  }

  /**
   * Validate a research definition
   */
  public validateResearchDefinition(research: unknown, id: string): ValidationResult {
    this.reset();
    const path = `Research[${id}]`;

    if (!this.isObject(research, path)) {
      return this.result();
    }

    const r = research as Record<string, unknown>;

    // Required fields
    this.requireString(r.id, `${path}.id`);
    this.requireString(r.name, `${path}.name`);
    this.requireString(r.description, `${path}.description`);
    this.requireString(r.faction, `${path}.faction`);
    this.requireNumber(r.mineralCost, `${path}.mineralCost`, 0);
    this.requireNumber(r.vespeneCost, `${path}.vespeneCost`, 0);
    this.requireNumber(r.researchTime, `${path}.researchTime`, 0);

    // Effects array
    if (!Array.isArray(r.effects)) {
      this.addError('invalid_type', `${path}.effects`, 'Must be an array of upgrade effects');
    } else {
      for (let i = 0; i < r.effects.length; i++) {
        this.validateUpgradeEffect(r.effects[i], `${path}.effects[${i}]`);
      }
    }

    // Optional fields
    this.optionalNumber(r.level, `${path}.level`, 1);
    this.optionalString(r.nextLevel, `${path}.nextLevel`);
    this.optionalString(r.icon, `${path}.icon`);
    this.optionalStringArray(r.requirements, `${path}.requirements`);

    return this.result();
  }

  /**
   * Validate an upgrade effect
   */
  private validateUpgradeEffect(effect: unknown, path: string): void {
    if (!this.isObject(effect, path)) return;

    const e = effect as Record<string, unknown>;

    if (!VALID_UPGRADE_EFFECT_TYPES.includes(e.type as any)) {
      this.addError(
        'invalid_type',
        `${path}.type`,
        `Must be one of: ${VALID_UPGRADE_EFFECT_TYPES.join(', ')}`,
        e.type
      );
    }

    this.requireNumber(e.value, `${path}.value`);
    this.optionalStringArray(e.targets, `${path}.targets`);

    if (e.unitTypes !== undefined) {
      if (!Array.isArray(e.unitTypes)) {
        this.addError('invalid_type', `${path}.unitTypes`, 'Must be an array');
      } else {
        for (const ut of e.unitTypes) {
          if (!VALID_UNIT_CATEGORIES.includes(ut as any)) {
            this.addError(
              'invalid_type',
              `${path}.unitTypes`,
              `Invalid unit type: ${ut}. Must be one of: ${VALID_UNIT_CATEGORIES.join(', ')}`
            );
          }
        }
      }
    }
  }

  /**
   * Validate an ability definition
   */
  public validateAbilityDefinition(ability: unknown, id: string): ValidationResult {
    this.reset();
    const path = `Ability[${id}]`;

    if (!this.isObject(ability, path)) {
      return this.result();
    }

    const a = ability as Record<string, unknown>;

    // Required fields
    this.requireString(a.id, `${path}.id`);
    this.requireString(a.name, `${path}.name`);
    this.requireString(a.description, `${path}.description`);
    this.requireNumber(a.cooldown, `${path}.cooldown`, 0);
    this.requireNumber(a.energyCost, `${path}.energyCost`, 0);
    this.requireNumber(a.range, `${path}.range`, 0);
    this.requireString(a.hotkey, `${path}.hotkey`);

    if (!VALID_TARGET_TYPES.includes(a.targetType as AbilityTargetType)) {
      this.addError(
        'invalid_type',
        `${path}.targetType`,
        `Must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
        a.targetType
      );
    }

    // Optional fields
    this.optionalString(a.iconId, `${path}.iconId`);
    this.optionalNumber(a.damage, `${path}.damage`, 0);
    this.optionalNumber(a.healing, `${path}.healing`, 0);
    this.optionalNumber(a.duration, `${path}.duration`, 0);
    this.optionalNumber(a.aoeRadius, `${path}.aoeRadius`, 0);
    this.optionalString(a.buffId, `${path}.buffId`);

    return this.result();
  }

  /**
   * Validate cross-references between definitions
   */
  public validateReferences(
    units: Record<string, UnitDefinition>,
    buildings: Record<string, BuildingDefinition>,
    research: Record<string, ResearchDefinition>,
    abilities: Record<string, AbilityDefinition>,
    projectileTypes?: Set<string>
  ): ValidationResult {
    this.reset();

    // Validate unit references
    for (const [id, unit] of Object.entries(units)) {
      // Validate ability references
      if (unit.abilities) {
        for (const abilityId of unit.abilities) {
          if (!abilities[abilityId]) {
            this.addError(
              'invalid_reference',
              `Unit[${id}].abilities`,
              `References unknown ability: ${abilityId}`
            );
          }
        }
      }

      // Validate projectileType references
      if (projectileTypes && (unit as any).projectileType) {
        const projectileType = (unit as any).projectileType as string;
        if (!projectileTypes.has(projectileType)) {
          this.addError(
            'invalid_reference',
            `Unit[${id}].projectileType`,
            `References unknown projectile type: ${projectileType}`
          );
        }
      }

      // Validate transform mode projectileType references
      if ((unit as any).transformModes && projectileTypes) {
        const modes = (unit as any).transformModes as TransformMode[];
        for (let i = 0; i < modes.length; i++) {
          const mode = modes[i];
          if ((mode as any).projectileType) {
            const projectileType = (mode as any).projectileType as string;
            if (!projectileTypes.has(projectileType)) {
              this.addError(
                'invalid_reference',
                `Unit[${id}].transformModes[${i}].projectileType`,
                `References unknown projectile type: ${projectileType}`
              );
            }
          }
        }
      }
    }

    // Validate building references
    for (const [id, building] of Object.entries(buildings)) {
      if (building.canProduce) {
        for (const unitId of building.canProduce) {
          if (!units[unitId]) {
            this.addError(
              'invalid_reference',
              `Building[${id}].canProduce`,
              `References unknown unit: ${unitId}`
            );
          }
        }
      }

      if (building.canResearch) {
        for (const researchId of building.canResearch) {
          if (!research[researchId]) {
            this.addError(
              'invalid_reference',
              `Building[${id}].canResearch`,
              `References unknown research: ${researchId}`
            );
          }
        }
      }

      if (building.requirements) {
        for (const reqId of building.requirements) {
          if (!buildings[reqId]) {
            this.addError(
              'invalid_reference',
              `Building[${id}].requirements`,
              `References unknown building: ${reqId}`
            );
          }
        }
      }

      if (building.canUpgradeTo) {
        for (const upgradeId of building.canUpgradeTo) {
          if (!buildings[upgradeId]) {
            this.addError(
              'invalid_reference',
              `Building[${id}].canUpgradeTo`,
              `References unknown building: ${upgradeId}`
            );
          }
        }
      }

      // Validate building projectileType (for turrets/defensive structures)
      if (projectileTypes && (building as any).projectileType) {
        const projectileType = (building as any).projectileType as string;
        if (!projectileTypes.has(projectileType)) {
          this.addError(
            'invalid_reference',
            `Building[${id}].projectileType`,
            `References unknown projectile type: ${projectileType}`
          );
        }
      }
    }

    // Validate research references
    for (const [id, res] of Object.entries(research)) {
      if (res.requirements) {
        for (const reqId of res.requirements) {
          if (!buildings[reqId] && !research[reqId]) {
            this.addError(
              'invalid_reference',
              `Research[${id}].requirements`,
              `References unknown building or research: ${reqId}`
            );
          }
        }
      }

      if (res.nextLevel && !research[res.nextLevel]) {
        this.addError(
          'invalid_reference',
          `Research[${id}].nextLevel`,
          `References unknown research: ${res.nextLevel}`
        );
      }

      // Validate effect targets
      for (const effect of res.effects) {
        if (effect.targets) {
          for (const targetId of effect.targets) {
            if (!units[targetId] && !buildings[targetId]) {
              this.addWarning(
                'unused_reference',
                `Research[${id}].effects.targets`,
                `Target '${targetId}' not found in units or buildings`
              );
            }
          }
        }
      }
    }

    return this.result();
  }

  // Helper methods

  private reset(): void {
    this.errors = [];
    this.warnings = [];
  }

  private result(): ValidationResult {
    return {
      valid: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [...this.warnings],
    };
  }

  private addError(
    type: ValidationError['type'],
    path: string,
    message: string,
    value?: unknown
  ): void {
    this.errors.push({ type, path, message, value });
  }

  private addWarning(type: ValidationWarning['type'], path: string, message: string): void {
    this.warnings.push({ type, path, message });
  }

  private isObject(value: unknown, path: string): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.addError('invalid_type', path, 'Must be an object', value);
      return false;
    }
    return true;
  }

  private requireString(value: unknown, path: string): void {
    if (typeof value !== 'string' || value.length === 0) {
      this.addError('missing_required', path, 'Required string field is missing or empty', value);
    }
  }

  private optionalString(value: unknown, path: string): void {
    if (value !== undefined && typeof value !== 'string') {
      this.addError('invalid_type', path, 'Must be a string', value);
    }
  }

  private requireNumber(value: unknown, path: string, min?: number): void {
    if (typeof value !== 'number' || isNaN(value)) {
      this.addError('missing_required', path, 'Required number field is missing or invalid', value);
    } else if (min !== undefined && value < min) {
      this.addError('invalid_type', path, `Must be >= ${min}`, value);
    }
  }

  private optionalNumber(value: unknown, path: string, min?: number): void {
    if (value === undefined) return;
    if (typeof value !== 'number' || isNaN(value)) {
      this.addError('invalid_type', path, 'Must be a number', value);
    } else if (min !== undefined && value < min) {
      this.addError('invalid_type', path, `Must be >= ${min}`, value);
    }
  }

  private requireBoolean(value: unknown, path: string): void {
    if (typeof value !== 'boolean') {
      this.addError('missing_required', path, 'Required boolean field is missing', value);
    }
  }

  private optionalBoolean(value: unknown, path: string): void {
    if (value !== undefined && typeof value !== 'boolean') {
      this.addError('invalid_type', path, 'Must be a boolean', value);
    }
  }

  private optionalStringArray(value: unknown, path: string): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      this.addError('invalid_type', path, 'Must be an array', value);
      return;
    }
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') {
        this.addError('invalid_type', `${path}[${i}]`, 'Must be a string', value[i]);
      }
    }
  }
}

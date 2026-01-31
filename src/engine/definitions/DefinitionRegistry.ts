/**
 * Definition Registry
 *
 * Centralized registry for all game definitions. Provides a unified API
 * for accessing units, buildings, research, and abilities regardless of
 * whether they were loaded from JSON or TypeScript.
 *
 * This is the main entry point for the data-driven definition system.
 */

import { DefinitionLoader } from './DefinitionLoader';
import { debugAssets } from '@/utils/debugLogger';
import type {
  UnitDefinition,
  BuildingDefinition,
  ResearchDefinition,
  AbilityDefinition,
  WallDefinition,
  WallUpgradeDefinition,
  GameManifest,
  FactionManifest,
  FactionData,
  UnitCategory,
} from './types';

export interface RegistryStats {
  factions: number;
  units: number;
  buildings: number;
  research: number;
  abilities: number;
}

/**
 * Singleton registry for all game definitions
 */
class DefinitionRegistryClass {
  private loader: DefinitionLoader;
  private initialized: boolean = false;
  private initializing: Promise<void> | null = null;

  // Game manifest
  private gameManifest: GameManifest | null = null;

  // Faction data
  private factions: Map<string, FactionData> = new Map();

  // Combined indices for quick lookup across all factions
  private allUnits: Map<string, UnitDefinition> = new Map();
  private allBuildings: Map<string, BuildingDefinition> = new Map();
  private allResearch: Map<string, ResearchDefinition> = new Map();
  private allAbilities: Map<string, AbilityDefinition> = new Map();
  private allWalls: Map<string, WallDefinition> = new Map();
  private allWallUpgrades: Map<string, WallUpgradeDefinition> = new Map();

  // Unit type mappings
  private unitTypes: Map<string, UnitCategory> = new Map();

  // Addon unit mappings
  private researchModuleUnits: Map<string, string[]> = new Map();
  private productionModuleUnits: Map<string, string[]> = new Map();

  constructor() {
    this.loader = new DefinitionLoader();
  }

  /**
   * Initialize the registry from a game manifest file
   */
  public async loadFromManifest(manifestPath: string = '/data/game.json'): Promise<void> {
    // Prevent double initialization
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.doLoadFromManifest(manifestPath);
    await this.initializing;
    this.initializing = null;
  }

  private async doLoadFromManifest(manifestPath: string): Promise<void> {
    // Set base path from manifest path
    const basePath = manifestPath.substring(0, manifestPath.lastIndexOf('/'));
    this.loader.setBasePath(basePath);

    // Load game manifest
    const manifestResult = await this.loader.loadGameManifest(
      manifestPath.substring(manifestPath.lastIndexOf('/') + 1)
    );

    if (!manifestResult.success) {
      throw new Error(`Failed to load game manifest: ${manifestResult.errors.join(', ')}`);
    }

    this.gameManifest = manifestResult.data!;

    // Load all factions
    const factionsResult = await this.loader.loadAllFactions(this.gameManifest);

    if (!factionsResult.success) {
      throw new Error(`Failed to load factions: ${factionsResult.errors.join(', ')}`);
    }

    // Store faction data and build indices
    this.factions = factionsResult.data!;
    this.rebuildIndices();

    this.initialized = true;
    debugAssets.log(`[DefinitionRegistry] Loaded ${this.factions.size} faction(s)`);
    debugAssets.log(`[DefinitionRegistry] Stats:`, this.getStats());
  }

  /**
   * Register a faction directly from TypeScript data (for backwards compatibility)
   */
  public registerFaction(
    factionId: string,
    data: {
      manifest?: Partial<FactionManifest>;
      units: Record<string, UnitDefinition>;
      buildings: Record<string, BuildingDefinition>;
      research: Record<string, ResearchDefinition>;
      abilities: Record<string, AbilityDefinition>;
      walls?: Record<string, WallDefinition>;
      wallUpgrades?: Record<string, WallUpgradeDefinition>;
      unitTypes?: Record<string, UnitCategory>;
      addonUnits?: {
        researchModule?: Record<string, string[]>;
        productionModule?: Record<string, string[]>;
      };
    }
  ): void {
    const factionData: FactionData = {
      manifest: {
        id: factionId,
        name: data.manifest?.name || factionId,
        description: data.manifest?.description || '',
        color: data.manifest?.color || '#ffffff',
        unitsFile: 'units.json',
        buildingsFile: 'buildings.json',
        researchFile: 'research.json',
        abilitiesFile: 'abilities.json',
        ...data.manifest,
      },
      units: data.units,
      buildings: data.buildings,
      research: data.research,
      abilities: data.abilities,
      walls: data.walls,
      wallUpgrades: data.wallUpgrades,
      unitTypes: data.unitTypes || {},
      addonUnits: {
        researchModule: data.addonUnits?.researchModule || {},
        productionModule: data.addonUnits?.productionModule || {},
      },
    };

    this.factions.set(factionId, factionData);
    this.rebuildIndices();
    this.initialized = true;
  }

  /**
   * Rebuild the combined indices from all factions
   */
  private rebuildIndices(): void {
    this.allUnits.clear();
    this.allBuildings.clear();
    this.allResearch.clear();
    this.allAbilities.clear();
    this.allWalls.clear();
    this.allWallUpgrades.clear();
    this.unitTypes.clear();
    this.researchModuleUnits.clear();
    this.productionModuleUnits.clear();

    for (const [_factionId, faction] of this.factions) {
      // Units
      for (const [id, unit] of Object.entries(faction.units)) {
        this.allUnits.set(id, unit);
      }

      // Buildings (includes walls)
      for (const [id, building] of Object.entries(faction.buildings)) {
        this.allBuildings.set(id, building);
      }

      // Research
      for (const [id, research] of Object.entries(faction.research)) {
        this.allResearch.set(id, research);
      }

      // Abilities
      for (const [id, ability] of Object.entries(faction.abilities)) {
        this.allAbilities.set(id, ability);
      }

      // Walls
      if (faction.walls) {
        for (const [id, wall] of Object.entries(faction.walls)) {
          this.allWalls.set(id, wall);
        }
      }

      // Wall upgrades
      if (faction.wallUpgrades) {
        for (const [id, upgrade] of Object.entries(faction.wallUpgrades)) {
          this.allWallUpgrades.set(id, upgrade);
        }
      }

      // Unit types
      for (const [unitId, category] of Object.entries(faction.unitTypes)) {
        this.unitTypes.set(unitId, category);
      }

      // Addon units
      for (const [buildingId, units] of Object.entries(faction.addonUnits.researchModule)) {
        this.researchModuleUnits.set(buildingId, units);
      }

      for (const [buildingId, units] of Object.entries(faction.addonUnits.productionModule)) {
        this.productionModuleUnits.set(buildingId, units);
      }
    }
  }

  /**
   * Check if registry is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Wait for initialization to complete
   */
  public async waitForInitialization(): Promise<void> {
    if (this.initializing) {
      await this.initializing;
    }
  }

  /**
   * Get registry statistics
   */
  public getStats(): RegistryStats {
    return {
      factions: this.factions.size,
      units: this.allUnits.size,
      buildings: this.allBuildings.size,
      research: this.allResearch.size,
      abilities: this.allAbilities.size,
    };
  }

  // ==================== FACTION ACCESS ====================

  /**
   * Get all registered faction IDs
   */
  public getFactionIds(): string[] {
    return Array.from(this.factions.keys());
  }

  /**
   * Get faction data by ID
   */
  public getFaction(factionId: string): FactionData | undefined {
    return this.factions.get(factionId);
  }

  /**
   * Get the default faction ID
   */
  public getDefaultFactionId(): string | undefined {
    return this.gameManifest?.defaultFaction || this.factions.keys().next().value;
  }

  // ==================== UNIT ACCESS ====================

  /**
   * Get a unit definition by ID
   */
  public getUnit(unitId: string): UnitDefinition | undefined {
    return this.allUnits.get(unitId);
  }

  /**
   * Get all unit definitions
   */
  public getAllUnits(): Record<string, UnitDefinition> {
    return Object.fromEntries(this.allUnits);
  }

  /**
   * Get unit definitions for a specific faction
   */
  public getUnitsByFaction(factionId: string): Record<string, UnitDefinition> {
    const faction = this.factions.get(factionId);
    return faction?.units || {};
  }

  /**
   * Get the unit type category
   */
  public getUnitType(unitId: string): UnitCategory | undefined {
    return this.unitTypes.get(unitId);
  }

  /**
   * Get all unit type mappings
   */
  public getUnitTypes(): Record<string, UnitCategory> {
    return Object.fromEntries(this.unitTypes);
  }

  // ==================== BUILDING ACCESS ====================

  /**
   * Get a building definition by ID
   */
  public getBuilding(buildingId: string): BuildingDefinition | undefined {
    return this.allBuildings.get(buildingId);
  }

  /**
   * Get all building definitions
   */
  public getAllBuildings(): Record<string, BuildingDefinition> {
    return Object.fromEntries(this.allBuildings);
  }

  /**
   * Get building definitions for a specific faction
   */
  public getBuildingsByFaction(factionId: string): Record<string, BuildingDefinition> {
    const faction = this.factions.get(factionId);
    return faction?.buildings || {};
  }

  // ==================== RESEARCH ACCESS ====================

  /**
   * Get a research definition by ID
   */
  public getResearch(researchId: string): ResearchDefinition | undefined {
    return this.allResearch.get(researchId);
  }

  /**
   * Get all research definitions
   */
  public getAllResearch(): Record<string, ResearchDefinition> {
    return Object.fromEntries(this.allResearch);
  }

  /**
   * Get research definitions for a specific faction
   */
  public getResearchByFaction(factionId: string): Record<string, ResearchDefinition> {
    const faction = this.factions.get(factionId);
    return faction?.research || {};
  }

  // ==================== ABILITY ACCESS ====================

  /**
   * Get an ability definition by ID
   */
  public getAbility(abilityId: string): AbilityDefinition | undefined {
    return this.allAbilities.get(abilityId);
  }

  /**
   * Get all ability definitions
   */
  public getAllAbilities(): Record<string, AbilityDefinition> {
    return Object.fromEntries(this.allAbilities);
  }

  /**
   * Get ability definitions for a specific faction
   */
  public getAbilitiesByFaction(factionId: string): Record<string, AbilityDefinition> {
    const faction = this.factions.get(factionId);
    return faction?.abilities || {};
  }

  // ==================== WALL ACCESS ====================

  /**
   * Get a wall definition by ID
   */
  public getWall(wallId: string): WallDefinition | undefined {
    return this.allWalls.get(wallId);
  }

  /**
   * Get all wall definitions
   */
  public getAllWalls(): Record<string, WallDefinition> {
    return Object.fromEntries(this.allWalls);
  }

  /**
   * Get a wall upgrade definition by ID
   */
  public getWallUpgrade(upgradeId: string): WallUpgradeDefinition | undefined {
    return this.allWallUpgrades.get(upgradeId);
  }

  /**
   * Get all wall upgrade definitions
   */
  public getAllWallUpgrades(): Record<string, WallUpgradeDefinition> {
    return Object.fromEntries(this.allWallUpgrades);
  }

  // ==================== ADDON ACCESS ====================

  /**
   * Get units unlocked by research module for a building
   */
  public getResearchModuleUnits(buildingId: string): string[] {
    return this.researchModuleUnits.get(buildingId) || [];
  }

  /**
   * Get all research module unit mappings
   */
  public getAllResearchModuleUnits(): Record<string, string[]> {
    return Object.fromEntries(this.researchModuleUnits);
  }

  /**
   * Get units that can be double-produced with production module
   */
  public getProductionModuleUnits(buildingId: string): string[] {
    return this.productionModuleUnits.get(buildingId) || [];
  }

  /**
   * Get all production module unit mappings
   */
  public getAllProductionModuleUnits(): Record<string, string[]> {
    return Object.fromEntries(this.productionModuleUnits);
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Get available research for a building (convenience method)
   */
  public getAvailableResearch(buildingId: string): ResearchDefinition[] {
    const building = this.getBuilding(buildingId);
    if (!building || !building.canResearch) return [];

    return building.canResearch
      .map((id) => this.getResearch(id))
      .filter((r): r is ResearchDefinition => r !== undefined);
  }

  /**
   * Get produceable units for a building (convenience method)
   */
  public getProduceableUnits(buildingId: string, hasResearchModule: boolean = false): UnitDefinition[] {
    const building = this.getBuilding(buildingId);
    if (!building || !building.canProduce) return [];

    const unitIds = [...building.canProduce];

    // Add research module units if applicable
    if (hasResearchModule) {
      const extraUnits = this.getResearchModuleUnits(buildingId);
      unitIds.push(...extraUnits);
    }

    return unitIds
      .map((id) => this.getUnit(id))
      .filter((u): u is UnitDefinition => u !== undefined);
  }

  /**
   * Clear all registered data (for testing or hot-reload)
   */
  public clear(): void {
    this.factions.clear();
    this.allUnits.clear();
    this.allBuildings.clear();
    this.allResearch.clear();
    this.allAbilities.clear();
    this.allWalls.clear();
    this.allWallUpgrades.clear();
    this.unitTypes.clear();
    this.researchModuleUnits.clear();
    this.productionModuleUnits.clear();
    this.gameManifest = null;
    this.initialized = false;
    this.loader.clearCache();
  }

  // ==================== DATA-DRIVEN CONFIG ACCESS ====================
  // These methods provide access to the new data-driven configuration systems.
  // They re-export from the respective data modules for centralized access.

  /**
   * Get combat configuration (damage types, armor types, multipliers).
   * @see @/data/combat/combat.ts
   */
  public getCombatConfig() {
    // Lazy import to avoid circular dependencies
    const combat = require('@/data/combat/combat');
    return {
      damageTypes: combat.DAMAGE_TYPES,
      armorTypes: combat.ARMOR_TYPES,
      multipliers: combat.DAMAGE_MULTIPLIERS,
      config: combat.COMBAT_CONFIG,
      getDamageMultiplier: combat.getDamageMultiplier,
    };
  }

  /**
   * Get resource type definitions.
   * @see @/data/resources/resources.ts
   */
  public getResourceTypes() {
    const resources = require('@/data/resources/resources');
    return {
      types: resources.RESOURCE_TYPES,
      config: resources.RESOURCE_SYSTEM_CONFIG,
      startingResources: resources.STARTING_RESOURCES,
      getResourceType: resources.getResourceType,
      getResourceTypeIds: resources.getResourceTypeIds,
    };
  }

  /**
   * Get unit category definitions.
   * @see @/data/units/categories.ts
   */
  public getUnitCategories() {
    const categories = require('@/data/units/categories');
    return {
      categories: categories.UNIT_CATEGORIES,
      assignments: categories.UNIT_CATEGORY_ASSIGNMENTS,
      subcategories: categories.UNIT_SUBCATEGORIES,
      getCategory: categories.getCategory,
      getUnitCategory: categories.getUnitCategory,
    };
  }

  /**
   * Get formation definitions.
   * @see @/data/formations/formations.ts
   */
  public getFormations() {
    const formations = require('@/data/formations/formations');
    return {
      formations: formations.FORMATION_DEFINITIONS,
      config: formations.FORMATION_CONFIG,
      getFormation: formations.getFormation,
      generateFormationPositions: formations.generateFormationPositions,
    };
  }

  /**
   * Get AI build order configuration.
   * @see @/data/ai/buildOrders.ts
   */
  public getAIConfig() {
    const ai = require('@/data/ai/buildOrders');
    return {
      difficultyConfig: ai.AI_DIFFICULTY_CONFIG,
      buildOrders: ai.FACTION_BUILD_ORDERS,
      unitCompositions: ai.FACTION_UNIT_COMPOSITIONS,
      getAIConfig: ai.getAIConfig,
      getBuildOrders: ai.getBuildOrders,
      selectUnitToBuild: ai.selectUnitToBuild,
    };
  }

  /**
   * Get ability definitions.
   * @see @/data/abilities/abilities.ts
   */
  public getAbilityDefinitions() {
    const abilities = require('@/data/abilities/abilities');
    return {
      abilities: abilities.ABILITY_DEFINITIONS,
      registry: abilities.AbilityRegistry,
      getAbility: abilities.getAbility,
    };
  }
}

// Export singleton instance
export const DefinitionRegistry = new DefinitionRegistryClass();

// Export class for testing
export { DefinitionRegistryClass };

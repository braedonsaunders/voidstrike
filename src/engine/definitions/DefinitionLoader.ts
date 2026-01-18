/**
 * Definition Loader
 *
 * Loads game definitions from JSON files at runtime.
 * Supports loading from local files (public directory) or URLs.
 */

import { DefinitionValidator } from './DefinitionValidator';
import { debugAssets } from '@/utils/debugLogger';
import type {
  UnitDefinition,
  BuildingDefinition,
  ResearchDefinition,
  AbilityDefinition,
  WallDefinition,
  WallUpgradeDefinition,
  FactionManifest,
  GameManifest,
  FactionData,
  ValidationResult,
  UnitCategory,
} from './types';

export interface LoadResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
}

export class DefinitionLoader {
  private validator: DefinitionValidator;
  private basePath: string;
  private cache: Map<string, unknown> = new Map();

  constructor(basePath: string = '/data') {
    this.validator = new DefinitionValidator();
    this.basePath = basePath;
  }

  /**
   * Set the base path for loading definitions
   */
  public setBasePath(path: string): void {
    this.basePath = path;
  }

  /**
   * Clear the loading cache
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Load and parse a JSON file
   */
  private async loadJSON<T>(path: string): Promise<LoadResult<T>> {
    const fullPath = path.startsWith('http') ? path : `${this.basePath}/${path}`;

    // Check cache
    if (this.cache.has(fullPath)) {
      return { success: true, data: this.cache.get(fullPath) as T, errors: [] };
    }

    try {
      const response = await fetch(fullPath);

      if (!response.ok) {
        return {
          success: false,
          errors: [`Failed to load ${fullPath}: ${response.status} ${response.statusText}`],
        };
      }

      const data = await response.json();
      this.cache.set(fullPath, data);

      return { success: true, data: data as T, errors: [] };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to load ${fullPath}: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  /**
   * Load the game manifest
   */
  public async loadGameManifest(path: string = 'game.json'): Promise<LoadResult<GameManifest>> {
    const result = await this.loadJSON<GameManifest>(path);

    if (!result.success) {
      return result;
    }

    const validation = this.validator.validateGameManifest(result.data);
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors.map((e) => `${e.path}: ${e.message}`),
      };
    }

    return result;
  }

  /**
   * Load a faction manifest
   */
  public async loadFactionManifest(factionPath: string): Promise<LoadResult<FactionManifest>> {
    const result = await this.loadJSON<FactionManifest>(`${factionPath}/manifest.json`);

    if (!result.success) {
      return result;
    }

    const validation = this.validator.validateFactionManifest(result.data);
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors.map((e) => `${e.path}: ${e.message}`),
      };
    }

    return result;
  }

  /**
   * Load unit definitions from a JSON file
   */
  public async loadUnits(
    factionPath: string,
    filename: string
  ): Promise<LoadResult<Record<string, UnitDefinition>>> {
    const result = await this.loadJSON<Record<string, UnitDefinition>>(`${factionPath}/${filename}`);

    if (!result.success) {
      return result;
    }

    const errors: string[] = [];

    for (const [id, unit] of Object.entries(result.data!)) {
      const validation = this.validator.validateUnitDefinition(unit, id);
      if (!validation.valid) {
        errors.push(...validation.errors.map((e) => `${e.path}: ${e.message}`));
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return result;
  }

  /**
   * Load building definitions from a JSON file
   */
  public async loadBuildings(
    factionPath: string,
    filename: string
  ): Promise<LoadResult<Record<string, BuildingDefinition>>> {
    const result = await this.loadJSON<Record<string, BuildingDefinition>>(`${factionPath}/${filename}`);

    if (!result.success) {
      return result;
    }

    const errors: string[] = [];

    for (const [id, building] of Object.entries(result.data!)) {
      const validation = this.validator.validateBuildingDefinition(building, id);
      if (!validation.valid) {
        errors.push(...validation.errors.map((e) => `${e.path}: ${e.message}`));
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return result;
  }

  /**
   * Load research definitions from a JSON file
   */
  public async loadResearch(
    factionPath: string,
    filename: string
  ): Promise<LoadResult<Record<string, ResearchDefinition>>> {
    const result = await this.loadJSON<Record<string, ResearchDefinition>>(`${factionPath}/${filename}`);

    if (!result.success) {
      return result;
    }

    const errors: string[] = [];

    for (const [id, research] of Object.entries(result.data!)) {
      const validation = this.validator.validateResearchDefinition(research, id);
      if (!validation.valid) {
        errors.push(...validation.errors.map((e) => `${e.path}: ${e.message}`));
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return result;
  }

  /**
   * Load ability definitions from a JSON file
   */
  public async loadAbilities(
    factionPath: string,
    filename: string
  ): Promise<LoadResult<Record<string, AbilityDefinition>>> {
    const result = await this.loadJSON<Record<string, AbilityDefinition>>(`${factionPath}/${filename}`);

    if (!result.success) {
      return result;
    }

    const errors: string[] = [];

    for (const [id, ability] of Object.entries(result.data!)) {
      const validation = this.validator.validateAbilityDefinition(ability, id);
      if (!validation.valid) {
        errors.push(...validation.errors.map((e) => `${e.path}: ${e.message}`));
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return result;
  }

  /**
   * Load wall definitions (optional)
   */
  public async loadWalls(
    factionPath: string,
    filename: string
  ): Promise<LoadResult<Record<string, WallDefinition>>> {
    return this.loadJSON<Record<string, WallDefinition>>(`${factionPath}/${filename}`);
  }

  /**
   * Load wall upgrade definitions (optional)
   */
  public async loadWallUpgrades(
    factionPath: string,
    filename: string
  ): Promise<LoadResult<Record<string, WallUpgradeDefinition>>> {
    return this.loadJSON<Record<string, WallUpgradeDefinition>>(`${factionPath}/${filename}`);
  }

  /**
   * Load all data for a faction
   */
  public async loadFaction(factionPath: string): Promise<LoadResult<FactionData>> {
    const errors: string[] = [];

    // Load manifest first
    const manifestResult = await this.loadFactionManifest(factionPath);
    if (!manifestResult.success) {
      return { success: false, errors: manifestResult.errors };
    }

    const manifest = manifestResult.data!;

    // Load all definition files
    const [unitsResult, buildingsResult, researchResult, abilitiesResult] = await Promise.all([
      this.loadUnits(factionPath, manifest.unitsFile),
      this.loadBuildings(factionPath, manifest.buildingsFile),
      this.loadResearch(factionPath, manifest.researchFile),
      this.loadAbilities(factionPath, manifest.abilitiesFile),
    ]);

    if (!unitsResult.success) errors.push(...unitsResult.errors);
    if (!buildingsResult.success) errors.push(...buildingsResult.errors);
    if (!researchResult.success) errors.push(...researchResult.errors);
    if (!abilitiesResult.success) errors.push(...abilitiesResult.errors);

    if (errors.length > 0) {
      return { success: false, errors };
    }

    // Load optional files
    let walls: Record<string, WallDefinition> | undefined;
    let wallUpgrades: Record<string, WallUpgradeDefinition> | undefined;

    if (manifest.wallsFile) {
      const wallsResult = await this.loadWalls(factionPath, manifest.wallsFile);
      if (wallsResult.success) {
        walls = wallsResult.data;
      }
    }

    if (manifest.wallUpgradesFile) {
      const wallUpgradesResult = await this.loadWallUpgrades(factionPath, manifest.wallUpgradesFile);
      if (wallUpgradesResult.success) {
        wallUpgrades = wallUpgradesResult.data;
      }
    }

    // Merge walls into buildings if present
    const buildings = { ...buildingsResult.data! };
    if (walls) {
      for (const [id, wall] of Object.entries(walls)) {
        buildings[id] = wall;
      }
    }

    // Validate cross-references
    const refValidation = this.validator.validateReferences(
      unitsResult.data!,
      buildings,
      researchResult.data!,
      abilitiesResult.data!
    );

    if (!refValidation.valid) {
      errors.push(...refValidation.errors.map((e) => `${e.path}: ${e.message}`));
      return { success: false, errors };
    }

    // Log warnings
    for (const warning of refValidation.warnings) {
      debugAssets.warn(`[DefinitionLoader] Warning: ${warning.path}: ${warning.message}`);
    }

    return {
      success: true,
      data: {
        manifest,
        units: unitsResult.data!,
        buildings,
        research: researchResult.data!,
        abilities: abilitiesResult.data!,
        walls,
        wallUpgrades,
        unitTypes: manifest.unitTypes || {},
        addonUnits: {
          researchModule: manifest.addonUnits?.researchModule || {},
          productionModule: manifest.addonUnits?.productionModule || {},
        },
      },
      errors: [],
    };
  }

  /**
   * Load all factions from a game manifest
   */
  public async loadAllFactions(
    gameManifest: GameManifest
  ): Promise<LoadResult<Map<string, FactionData>>> {
    const factions = new Map<string, FactionData>();
    const errors: string[] = [];

    for (const factionPath of gameManifest.factions) {
      const result = await this.loadFaction(`factions/${factionPath}`);

      if (!result.success) {
        errors.push(`Failed to load faction ${factionPath}:`, ...result.errors);
        continue;
      }

      factions.set(result.data!.manifest.id, result.data!);
    }

    if (errors.length > 0 && factions.size === 0) {
      return { success: false, errors };
    }

    return {
      success: true,
      data: factions,
      errors,
    };
  }
}

/**
 * Scouting Memory System for RTS AI
 *
 * Tracks and remembers information gathered through scouting:
 * - Enemy building locations and types
 * - Enemy army composition estimates
 * - Tech path inference from observed buildings
 * - Knowledge decay over time (forget stale info)
 *
 * Allows AI to make strategic decisions based on gathered intelligence.
 */

import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { distance } from '@/utils/math';

/**
 * Types of enemy strategy the AI can infer
 */
export type InferredStrategy =
  | 'unknown'
  | 'rush' // Early aggression, few workers
  | 'timing_attack' // Building up for specific timing
  | 'macro' // Economy focus, multiple bases
  | 'tech' // Tech-heavy build
  | 'turtle' // Defensive, slow expand
  | 'air_transition' // Transitioning to air
  | 'all_in'; // Committing everything

/**
 * Confidence level for inferences
 */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * A scouted building entry
 */
export interface ScoutedBuilding {
  buildingId: string;
  entityId: number;
  position: { x: number; y: number };
  /** Tick when first scouted */
  firstSeenTick: number;
  /** Tick when last confirmed */
  lastSeenTick: number;
  /** Whether building is still believed to exist */
  confirmed: boolean;
  /** Confidence in this info (decays over time) */
  confidence: number;
  /** Was it complete when scouted? */
  wasComplete: boolean;
}

/**
 * A scouted unit type entry
 */
export interface ScoutedUnitType {
  unitId: string;
  /** Max count ever observed at once */
  maxCount: number;
  /** Last known count */
  lastCount: number;
  /** Tick when first scouted */
  firstSeenTick: number;
  /** Tick when last seen */
  lastSeenTick: number;
  /** Confidence in current count */
  confidence: number;
}

/**
 * Enemy base location
 */
export interface EnemyBase {
  position: { x: number; y: number };
  /** Is this the main base? */
  isMain: boolean;
  /** Tick when discovered */
  discoveredTick: number;
  /** Is this base still active? */
  active: boolean;
  /** Buildings at this base */
  buildingIds: number[];
}

/**
 * Strategic inference about enemy
 */
export interface StrategicInference {
  strategy: InferredStrategy;
  confidence: ConfidenceLevel;
  /** Supporting evidence */
  evidence: string[];
  /** Tick when inference was made */
  inferredTick: number;
  /** Recommended response */
  recommendation: string;
}

/**
 * Tech tree inference
 */
export interface TechInference {
  /** Tech buildings observed */
  techBuildings: string[];
  /** Units that could be produced */
  possibleUnits: string[];
  /** Units that definitely can be produced */
  confirmedUnits: string[];
  /** Highest tech level observed (1-3) */
  techLevel: number;
}

/**
 * Complete intel snapshot for an enemy player
 */
export interface EnemyIntel {
  playerId: string;

  // Scouted info
  buildings: Map<number, ScoutedBuilding>;
  unitTypes: Map<string, ScoutedUnitType>;
  bases: EnemyBase[];

  // Derived estimates
  estimatedWorkers: number;
  estimatedArmySupply: number;
  estimatedArmyValue: number;

  // Inferences
  strategy: StrategicInference;
  tech: TechInference;

  // Timing
  lastScoutTick: number;
  intelFreshness: number; // 0-1, how recent the intel is
}

/**
 * Tech tree relationships for inference
 */
const TECH_TREE: Record<string, { requires: string[]; enables: string[] }> = {
  // Dominion tech tree
  infantry_bay: { requires: [], enables: ['trooper', 'breacher', 'vanguard'] },
  forge: { requires: ['infantry_bay'], enables: ['scorcher', 'devastator', 'colossus'] },
  hangar: { requires: ['forge'], enables: ['valkyrie', 'specter', 'lifter'] },
  research_module: { requires: [], enables: ['breacher', 'devastator', 'operative'] },
};

/**
 * Strategy indicators
 */
const _STRATEGY_INDICATORS = {
  rush: {
    signs: ['early_aggression', 'low_workers', 'few_buildings', 'no_expansion'],
    antiSigns: ['expansion', 'high_tech'],
  },
  macro: {
    signs: ['expansion', 'high_workers', 'multiple_production'],
    antiSigns: ['early_aggression', 'low_workers'],
  },
  tech: {
    signs: ['early_gas', 'tech_buildings', 'low_army'],
    antiSigns: ['early_aggression', 'no_gas'],
  },
  turtle: {
    signs: ['defensive_buildings', 'late_expansion', 'static_defense'],
    antiSigns: ['early_expansion', 'mobile_army'],
  },
  air_transition: {
    signs: ['hangar', 'air_units', 'starport_activity'],
    antiSigns: ['no_air_tech'],
  },
};

/**
 * Scouting Memory - Tracks and infers enemy strategy
 */
export class ScoutingMemory {
  // Intel per enemy player
  private enemyIntel: Map<string, EnemyIntel> = new Map();

  // My player ID
  private myPlayerId: string;

  // Configuration
  private readonly intelDecayRate: number = 0.002; // Per tick
  private readonly confirmationThreshold: number = 0.3; // Below this, building assumed destroyed

  constructor(myPlayerId: string) {
    this.myPlayerId = myPlayerId;
  }

  /**
   * Update scouting memory with current vision
   */
  public update(world: World, currentTick: number, visibleEnemyIds: Set<number>): void {
    // Decay existing intel
    this.decayIntel(currentTick);

    // Update with currently visible enemies
    this.updateFromVision(world, currentTick, visibleEnemyIds);

    // Re-run strategic inference
    this.inferStrategies(currentTick);
  }

  /**
   * Decay confidence in old intel
   */
  private decayIntel(currentTick: number): void {
    for (const intel of this.enemyIntel.values()) {
      // Decay building confidence
      for (const building of intel.buildings.values()) {
        const ticksSinceSeen = currentTick - building.lastSeenTick;
        building.confidence = Math.max(0, building.confidence - ticksSinceSeen * this.intelDecayRate);

        if (building.confidence < this.confirmationThreshold) {
          building.confirmed = false;
        }
      }

      // Decay unit type confidence
      for (const unitType of intel.unitTypes.values()) {
        const ticksSinceSeen = currentTick - unitType.lastSeenTick;
        unitType.confidence = Math.max(0, unitType.confidence - ticksSinceSeen * this.intelDecayRate);
      }

      // Update intel freshness
      const ticksSinceScout = currentTick - intel.lastScoutTick;
      intel.intelFreshness = Math.max(0, 1 - ticksSinceScout * 0.001);
    }
  }

  /**
   * Update intel from currently visible enemies
   */
  private updateFromVision(
    world: World,
    currentTick: number,
    visibleEnemyIds: Set<number>
  ): void {
    // Track what we've seen this update
    const seenUnits: Map<string, Map<string, number>> = new Map(); // playerId -> unitId -> count

    for (const entityId of visibleEnemyIds) {
      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const selectable = entity.get<Selectable>('Selectable');
      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');

      if (!selectable || !transform || !health) continue;
      if (selectable.playerId === this.myPlayerId) continue;
      if (health.isDead()) continue;

      const playerId = selectable.playerId;
      const intel = this.getOrCreateIntel(playerId);
      intel.lastScoutTick = currentTick;

      // Track buildings
      const building = entity.get<Building>('Building');
      if (building) {
        this.updateBuildingIntel(intel, entityId, building, transform, currentTick);
        continue;
      }

      // Track units
      const unit = entity.get<Unit>('Unit');
      if (unit) {
        // Count units by type
        if (!seenUnits.has(playerId)) {
          seenUnits.set(playerId, new Map());
        }
        const playerUnits = seenUnits.get(playerId)!;
        playerUnits.set(unit.unitId, (playerUnits.get(unit.unitId) || 0) + 1);
      }
    }

    // Update unit type intel
    for (const [playerId, unitCounts] of seenUnits) {
      const intel = this.getOrCreateIntel(playerId);

      for (const [unitId, count] of unitCounts) {
        this.updateUnitTypeIntel(intel, unitId, count, currentTick);
      }
    }

    // Update estimates
    for (const intel of this.enemyIntel.values()) {
      this.updateEstimates(intel);
    }
  }

  /**
   * Update building intel
   */
  private updateBuildingIntel(
    intel: EnemyIntel,
    entityId: number,
    building: Building,
    transform: Transform,
    currentTick: number
  ): void {
    const existing = intel.buildings.get(entityId);

    if (existing) {
      // Update existing
      existing.lastSeenTick = currentTick;
      existing.confidence = 1.0;
      existing.confirmed = true;
      existing.wasComplete = building.isComplete();
    } else {
      // New building scouted
      intel.buildings.set(entityId, {
        buildingId: building.buildingId,
        entityId,
        position: { x: transform.x, y: transform.y },
        firstSeenTick: currentTick,
        lastSeenTick: currentTick,
        confirmed: true,
        confidence: 1.0,
        wasComplete: building.isComplete(),
      });

      // Check if this reveals a new base
      this.checkForNewBase(intel, transform, building, currentTick);
    }

    // Update tech inference
    this.updateTechInference(intel);
  }

  /**
   * Check if building reveals a new enemy base
   */
  private checkForNewBase(
    intel: EnemyIntel,
    transform: Transform,
    building: Building,
    currentTick: number
  ): void {
    // Main base building types
    const baseTypes = ['headquarters', 'orbital_station', 'bastion', 'nexus', 'hatchery', 'command_center'];

    if (!baseTypes.includes(building.buildingId)) return;

    // Check if this is near an existing known base
    for (const base of intel.bases) {
      if (distance(transform.x, transform.y, base.position.x, base.position.y) < 15) {
        // Near existing base, might be upgrade or replacement
        base.buildingIds.push(building.buildingId as unknown as number);
        return;
      }
    }

    // New base discovered
    intel.bases.push({
      position: { x: transform.x, y: transform.y },
      isMain: intel.bases.length === 0, // First base is main
      discoveredTick: currentTick,
      active: true,
      buildingIds: [],
    });
  }

  /**
   * Update unit type intel
   */
  private updateUnitTypeIntel(
    intel: EnemyIntel,
    unitId: string,
    count: number,
    currentTick: number
  ): void {
    const existing = intel.unitTypes.get(unitId);

    if (existing) {
      existing.lastSeenTick = currentTick;
      existing.lastCount = count;
      existing.maxCount = Math.max(existing.maxCount, count);
      existing.confidence = 1.0;
    } else {
      intel.unitTypes.set(unitId, {
        unitId,
        maxCount: count,
        lastCount: count,
        firstSeenTick: currentTick,
        lastSeenTick: currentTick,
        confidence: 1.0,
      });
    }

    // Add to confirmed units
    if (!intel.tech.confirmedUnits.includes(unitId)) {
      intel.tech.confirmedUnits.push(unitId);
    }
  }

  /**
   * Update tech inference from observed buildings
   */
  private updateTechInference(intel: EnemyIntel): void {
    intel.tech.techBuildings = [];
    intel.tech.possibleUnits = [];
    intel.tech.techLevel = 1;

    // Collect tech buildings
    for (const building of intel.buildings.values()) {
      if (!building.confirmed) continue;

      const techInfo = TECH_TREE[building.buildingId];
      if (techInfo) {
        intel.tech.techBuildings.push(building.buildingId);

        // Add enabled units to possible
        for (const unitId of techInfo.enables) {
          if (!intel.tech.possibleUnits.includes(unitId)) {
            intel.tech.possibleUnits.push(unitId);
          }
        }
      }

      // Determine tech level
      if (building.buildingId === 'forge') {
        intel.tech.techLevel = Math.max(intel.tech.techLevel, 2);
      }
      if (building.buildingId === 'hangar') {
        intel.tech.techLevel = Math.max(intel.tech.techLevel, 3);
      }
    }
  }

  /**
   * Update army/worker estimates
   */
  private updateEstimates(intel: EnemyIntel): void {
    // Estimate workers from bases and buildings
    let estimatedWorkers = 0;
    let _productionBuildings = 0;

    for (const building of intel.buildings.values()) {
      if (!building.confirmed) continue;

      // Count command centers for worker estimate
      if (['headquarters', 'orbital_station', 'nexus', 'hatchery'].includes(building.buildingId)) {
        estimatedWorkers += 16; // Assume ~16 workers per base
      }

      // Count production buildings
      if (['infantry_bay', 'forge', 'hangar'].includes(building.buildingId)) {
        _productionBuildings++;
      }
    }

    // Adjust for observed workers
    const workerTypes = intel.unitTypes.get('fabricator') || intel.unitTypes.get('probe') || intel.unitTypes.get('drone');
    if (workerTypes && workerTypes.confidence > 0.5) {
      estimatedWorkers = workerTypes.lastCount;
    }

    intel.estimatedWorkers = estimatedWorkers;

    // Estimate army from unit types
    let armySupply = 0;
    let armyValue = 0;

    for (const unitType of intel.unitTypes.values()) {
      const def = UNIT_DEFINITIONS[unitType.unitId];
      if (!def || def.isWorker) continue;

      // Use weighted average of last count and max count based on confidence
      const estimatedCount = unitType.lastCount * unitType.confidence +
                            unitType.maxCount * (1 - unitType.confidence) * 0.5;

      armySupply += def.supplyCost * estimatedCount;
      armyValue += (def.mineralCost + def.vespeneCost * 1.5) * estimatedCount;
    }

    intel.estimatedArmySupply = Math.round(armySupply);
    intel.estimatedArmyValue = Math.round(armyValue);
  }

  /**
   * Infer enemy strategies
   */
  private inferStrategies(currentTick: number): void {
    for (const intel of this.enemyIntel.values()) {
      const evidence: string[] = [];
      let strategy: InferredStrategy = 'unknown';
      let confidence: ConfidenceLevel = 'low';

      // Gather evidence
      const baseCount = intel.bases.filter(b => b.active).length;
      const hasExpansion = baseCount > 1;
      const hasEarlyGas = intel.buildings.size > 0 &&
        Array.from(intel.buildings.values()).some(b => b.buildingId === 'extractor' && b.firstSeenTick < 1200);
      const hasTechBuildings = intel.tech.techBuildings.length > 0;
      const hasAirTech = intel.tech.techBuildings.includes('hangar');
      const lowWorkers = intel.estimatedWorkers < 12;
      const highWorkers = intel.estimatedWorkers > 20;
      const hasAirUnits = intel.tech.confirmedUnits.some(u =>
        ['valkyrie', 'specter', 'lifter', 'phoenix', 'void_ray'].includes(u)
      );

      // Check for rush
      if (lowWorkers && !hasExpansion && intel.estimatedArmySupply > 8) {
        evidence.push('Low workers with army');
        evidence.push('No expansion');
        strategy = 'rush';
        confidence = 'medium';
      }
      // Check for macro
      else if (hasExpansion && highWorkers) {
        evidence.push('Has expansion');
        evidence.push('High worker count');
        strategy = 'macro';
        confidence = intel.intelFreshness > 0.7 ? 'high' : 'medium';
      }
      // Check for tech
      else if (hasEarlyGas && hasTechBuildings && intel.estimatedArmySupply < 10) {
        evidence.push('Early gas');
        evidence.push('Tech buildings');
        evidence.push('Low army');
        strategy = 'tech';
        confidence = 'medium';
      }
      // Check for air transition
      else if (hasAirTech || hasAirUnits) {
        evidence.push('Air tech/units observed');
        strategy = 'air_transition';
        confidence = hasAirUnits ? 'high' : 'medium';
      }

      // Generate recommendation
      let recommendation = '';
      switch (strategy) {
        case 'rush':
          recommendation = 'Build defensive units and prepare for early attack';
          break;
        case 'macro':
          recommendation = 'Match their expansion or prepare timing attack';
          break;
        case 'tech':
          recommendation = 'Apply early pressure before tech pays off';
          break;
        case 'air_transition':
          recommendation = 'Build anti-air units immediately';
          break;
        default:
          recommendation = 'Scout more to gather information';
      }

      intel.strategy = {
        strategy,
        confidence,
        evidence,
        inferredTick: currentTick,
        recommendation,
      };
    }
  }

  // ==================== PUBLIC API ====================

  /**
   * Get or create intel for an enemy player
   */
  public getOrCreateIntel(playerId: string): EnemyIntel {
    let intel = this.enemyIntel.get(playerId);
    if (!intel) {
      intel = {
        playerId,
        buildings: new Map(),
        unitTypes: new Map(),
        bases: [],
        estimatedWorkers: 0,
        estimatedArmySupply: 0,
        estimatedArmyValue: 0,
        strategy: {
          strategy: 'unknown',
          confidence: 'low',
          evidence: [],
          inferredTick: 0,
          recommendation: 'Scout to gather information',
        },
        tech: {
          techBuildings: [],
          possibleUnits: [],
          confirmedUnits: [],
          techLevel: 1,
        },
        lastScoutTick: 0,
        intelFreshness: 0,
      };
      this.enemyIntel.set(playerId, intel);
    }
    return intel;
  }

  /**
   * Get intel for an enemy player
   */
  public getIntel(playerId: string): EnemyIntel | undefined {
    return this.enemyIntel.get(playerId);
  }

  /**
   * Get all enemy intel
   */
  public getAllIntel(): EnemyIntel[] {
    return Array.from(this.enemyIntel.values());
  }

  /**
   * Get confirmed enemy buildings
   */
  public getConfirmedBuildings(playerId: string): ScoutedBuilding[] {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return [];
    return Array.from(intel.buildings.values()).filter(b => b.confirmed);
  }

  /**
   * Get estimated army composition
   */
  public getEstimatedComposition(playerId: string): Map<string, number> {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return new Map();

    const composition = new Map<string, number>();
    for (const [unitId, info] of intel.unitTypes) {
      if (info.confidence > 0.3) {
        composition.set(unitId, Math.round(info.lastCount * info.confidence + info.maxCount * (1 - info.confidence) * 0.3));
      }
    }
    return composition;
  }

  /**
   * Check if enemy has specific tech
   */
  public enemyHasTech(playerId: string, buildingId: string): boolean {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return false;
    return intel.tech.techBuildings.includes(buildingId);
  }

  /**
   * Check if enemy can produce a unit type
   */
  public enemyCanProduce(playerId: string, unitId: string): boolean {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return false;
    return intel.tech.possibleUnits.includes(unitId) || intel.tech.confirmedUnits.includes(unitId);
  }

  /**
   * Get enemy base locations
   */
  public getEnemyBases(playerId: string): EnemyBase[] {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return [];
    return intel.bases.filter(b => b.active);
  }

  /**
   * Get enemy main base location
   */
  public getEnemyMainBase(playerId: string): EnemyBase | null {
    const bases = this.getEnemyBases(playerId);
    return bases.find(b => b.isMain) || bases[0] || null;
  }

  /**
   * Mark a scouted building as destroyed
   */
  public markBuildingDestroyed(playerId: string, entityId: number): void {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return;

    const building = intel.buildings.get(entityId);
    if (building) {
      building.confirmed = false;
      building.confidence = 0;
    }
  }

  /**
   * Get strategic recommendation based on intel
   */
  public getStrategicRecommendation(playerId: string): string {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return 'Scout to gather information';
    return intel.strategy.recommendation;
  }

  /**
   * Should we build anti-air based on intel?
   */
  public shouldBuildAntiAir(playerId: string): boolean {
    const intel = this.enemyIntel.get(playerId);
    if (!intel) return false;

    return intel.strategy.strategy === 'air_transition' ||
           intel.tech.techBuildings.includes('hangar') ||
           intel.tech.confirmedUnits.some(u => ['valkyrie', 'specter', 'phoenix', 'void_ray', 'mutalisk'].includes(u));
  }

  /**
   * Clear all intel
   */
  public clear(): void {
    this.enemyIntel.clear();
  }
}

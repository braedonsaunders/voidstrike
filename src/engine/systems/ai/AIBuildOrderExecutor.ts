/**
 * AIBuildOrderExecutor - Build order execution and macro rule management
 *
 * Handles:
 * - Build order step execution (buildings, units, research)
 * - Data-driven macro rule evaluation and execution
 * - Building placement and addon construction
 * - Unit training
 * - Research initiation
 *
 * Integrates PositionalAnalysis primitive for strategic building placement:
 * - Uses analyzed expansion locations near mineral clusters
 * - Places defensive buildings near choke points
 * - Considers terrain when placing buildings
 *
 * Uses the data-driven FactionAIConfig for all production decisions.
 */

import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Building } from '../../components/Building';
import { Health } from '../../components/Health';
import { Selectable } from '../../components/Selectable';
import { Ability, DOMINION_ABILITIES } from '../../components/Ability';
import { Resource } from '../../components/Resource';
import type { Game } from '../../core/Game';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { RESEARCH_DEFINITIONS } from '@/data/research/dominion';
import { debugAI } from '@/utils/debugLogger';
import type { AICoordinator, AIPlayer } from './AICoordinator';
import { AIEconomyManager } from './AIEconomyManager';
import {
  type MacroRule,
  type RuleCondition,
  type MacroAction,
  type AIStateSnapshot,
  evaluateRule,
} from '@/data/ai/aiConfig';
import type { BuildOrderStep } from '@/data/ai/buildOrders';
import { getCounterRecommendation, analyzeThreatGaps } from '../AIMicroSystem';
import { distance } from '@/utils/math';

// Build order index for when we've finished the build order
const BUILD_ORDER_COMPLETE = 999;

export class AIBuildOrderExecutor {
  private game: Game;
  private coordinator: AICoordinator;
  private economyManager: AIEconomyManager | null = null;

  constructor(game: Game, coordinator: AICoordinator) {
    this.game = game;
    this.coordinator = coordinator;
  }

  private get world() {
    return this.game.world;
  }

  public setEconomyManager(economyManager: AIEconomyManager): void {
    this.economyManager = economyManager;
  }

  private getEconomyManager(): AIEconomyManager {
    if (!this.economyManager) {
      // Lazy init - get from coordinator if needed
      this.economyManager = new AIEconomyManager(this.game, this.coordinator);
    }
    return this.economyManager;
  }

  // === Build Order Execution ===

  /**
   * Execute the next step in the build order.
   */
  public executeBuildOrder(ai: AIPlayer): void {
    if (ai.buildOrderIndex >= ai.buildOrder.length) {
      return;
    }

    const step = ai.buildOrder[ai.buildOrderIndex];
    const currentTick = this.game.getCurrentTick();
    const shouldLog = currentTick % 100 === 0;

    // Check supply condition (BuildOrderStep uses 'supply' property)
    if (step.supply !== undefined && ai.supply < step.supply) {
      if (shouldLog) {
        debugAI.log(`[AIBuildOrder] ${ai.playerId}: Waiting for supply ${ai.supply}/${step.supply} for step ${ai.buildOrderIndex}: ${step.type} ${step.id}`);
      }
      return;
    }

    // For building steps, check if requirements are met before attempting
    // Don't count "waiting for requirements" as a failure
    if (step.type === 'building') {
      const buildingDef = BUILDING_DEFINITIONS[step.id];
      if (buildingDef?.requirements && buildingDef.requirements.length > 0) {
        for (const reqBuildingId of buildingDef.requirements) {
          if (!this.hasCompleteBuildingOfType(ai, reqBuildingId)) {
            if (shouldLog) {
              debugAI.log(`[AIBuildOrder] ${ai.playerId}: Waiting for requirement ${reqBuildingId} for building ${step.id}`);
            }
            return;
          }
        }
      }
    }

    // For unit steps, check if we have a production building
    if (step.type === 'unit') {
      if (!this.hasProductionBuildingForUnit(ai, step.id)) {
        // No production building yet - wait, don't count as failure
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] ${ai.playerId}: No production building for ${step.id}, waiting...`);
        }
        return;
      }
    }

    // Check resources and supply before attempting (avoid counting as failure)
    if (step.type === 'building') {
      const buildingDef = BUILDING_DEFINITIONS[step.id];
      if (buildingDef &&
          (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost)) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] ${ai.playerId}: Waiting for resources for ${step.id} (need ${buildingDef.mineralCost}M/${buildingDef.vespeneCost}G, have ${Math.floor(ai.minerals)}M/${Math.floor(ai.vespene)}G)`);
        }
        return;
      }
    }

    if (step.type === 'unit') {
      const unitDef = UNIT_DEFINITIONS[step.id];
      if (unitDef) {
        if (ai.minerals < unitDef.mineralCost || ai.vespene < unitDef.vespeneCost) {
          if (shouldLog) {
            debugAI.log(`[AIBuildOrder] ${ai.playerId}: Waiting for resources for ${step.id} (need ${unitDef.mineralCost}M/${unitDef.vespeneCost}G, have ${Math.floor(ai.minerals)}M/${Math.floor(ai.vespene)}G)`);
          }
          return;
        }
        if (ai.supply + unitDef.supplyCost > ai.maxSupply) {
          if (shouldLog) {
            debugAI.log(`[AIBuildOrder] ${ai.playerId}: Waiting for supply for ${step.id} (${ai.supply}+${unitDef.supplyCost} > ${ai.maxSupply})`);
          }
          return;
        }
      }
    }

    if (step.type === 'research') {
      const researchDef = RESEARCH_DEFINITIONS[step.id];
      if (ai.researchInProgress.has(step.id)) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] ${ai.playerId}: Research already in progress: ${step.id}`);
        }
        return;
      }
      if (researchDef &&
          (ai.minerals < researchDef.mineralCost || ai.vespene < researchDef.vespeneCost)) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] ${ai.playerId}: Waiting for resources for research ${step.id} (need ${researchDef.mineralCost}M/${researchDef.vespeneCost}G, have ${Math.floor(ai.minerals)}M/${Math.floor(ai.vespene)}G)`);
        }
        return;
      }
    }

    // Execute the step
    let success = this.executeBuildOrderStep(ai, step);

    if (success) {
      ai.buildOrderIndex++;
      ai.buildOrderFailureCount = 0;
      // Always log successful steps
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: Build order step ${ai.buildOrderIndex}/${ai.buildOrder.length} complete: ${step.type} ${step.id || ''}`);
    } else {
      ai.buildOrderFailureCount++;
      if (shouldLog) {
        debugAI.log(`[AIBuildOrder] ${ai.playerId}: Step ${ai.buildOrderIndex} failed (${ai.buildOrderFailureCount}/10): ${step.type} ${step.id}, minerals=${Math.floor(ai.minerals)}`);
      }
      if (ai.buildOrderFailureCount > 10) {
        // Skip problematic step after too many failures
        debugAI.warn(`[AIBuildOrder] ${ai.playerId}: Skipping stuck build order step: ${step.type} ${step.id || ''}`);
        ai.buildOrderIndex++;
        ai.buildOrderFailureCount = 0;
      }
    }
  }

  /**
   * Check if we have a completed production building that can train the specified unit.
   */
  private hasProductionBuildingForUnit(ai: AIPlayer, unitType: string): boolean {
    const buildings = this.coordinator.getCachedBuildings();
    const currentTick = this.game.getCurrentTick();
    const shouldLog = currentTick % 200 === 0;


    // Debug: log what we're looking for
    if (shouldLog && buildings.length === 0) {
      debugAI.warn(`[AIBuildOrder] ${ai.playerId}: No cached buildings found for production check`);
    }

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const health = entity.get<Health>('Health');

      if (!selectable || !building || !health) continue;
      if (selectable.playerId !== ai.playerId) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] Building ${entity.id} (${building.buildingId}) belongs to ${selectable.playerId}, not ${ai.playerId}`);
        }
        continue;
      }
      if (health.isDead()) continue;
      if (!building.isComplete()) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] Building ${entity.id} (${building.buildingId}) not complete: state=${building.state}, progress=${building.buildProgress}`);
        }
        continue;
      }
      if (!building.canProduce.includes(unitType)) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] Building ${entity.id} (${building.buildingId}) can't produce ${unitType}, canProduce=[${building.canProduce.join(',')}]`);
        }
        continue;
      }

      return true;
    }

    if (shouldLog) {
      debugAI.warn(`[AIBuildOrder] ${ai.playerId}: No production building found for ${unitType}. Total buildings checked: ${buildings.length}`);
    }
    return false;
  }

  private executeBuildOrderStep(ai: AIPlayer, step: BuildOrderStep): boolean {
    // BuildOrderStep uses 'id' for the target, and 'type' values: 'unit', 'building', 'research', 'ability'
    switch (step.type) {
      case 'building':
        return this.tryBuildBuilding(ai, step.id);
      case 'unit':
        return this.tryTrainUnit(ai, step.id);
      case 'research':
        return this.tryStartResearch(ai, step.id);
      case 'ability':
        return this.tryUseAbility(ai, step.id);
      default:
        debugAI.log(`[AIBuildOrder] ${ai.playerId}: Unknown build order step type: ${step.type}`);
        return true;
    }
  }

  // === Macro Rule Execution ===

  /**
   * Execute data-driven macro rules for continuous production.
   */
  public doMacro(ai: AIPlayer): void {
    const currentTick = this.game.getCurrentTick();
    const config = ai.config!;

    // Create state snapshot for rule evaluation
    const snapshot = this.coordinator.createStateSnapshot(ai, currentTick);

    // Counter-building logic for harder difficulties
    const diffConfig = config.difficultyConfig[ai.difficulty];
    if (diffConfig.counterBuildingEnabled) {
      this.handleCounterBuilding(ai, snapshot);
    }

    // Sort rules by priority (higher first)
    const sortedRules = [...config.macroRules].sort((a, b) => b.priority - a.priority);

    // Try to execute rules
    for (const rule of sortedRules) {
      // Check difficulty restriction
      if (rule.difficulties && !rule.difficulties.includes(ai.difficulty)) {
        continue;
      }

      // Check cooldown
      const lastExecution = ai.macroRuleCooldowns.get(rule.id) || 0;
      if (currentTick - lastExecution < rule.cooldownTicks) {
        continue;
      }

      // Evaluate rule conditions
      if (!evaluateRule(rule, snapshot)) {
        continue;
      }

      // Execute rule action
      const success = this.executeRuleAction(ai, rule.action, snapshot);
      if (success) {
        ai.macroRuleCooldowns.set(rule.id, currentTick);
        // Only execute one production rule per tick to prevent over-spending
        if (rule.action.type === 'train' || rule.action.type === 'build') {
          break;
        }
      }
    }
  }

  private handleCounterBuilding(ai: AIPlayer, snapshot: AIStateSnapshot): void {
    const recommendation = getCounterRecommendation(
      this.world,
      ai.playerId,
      ai.buildingCounts
    );

    // Check for urgent anti-air needs
    const threatGaps = analyzeThreatGaps(this.world, ai.playerId);
    if (threatGaps.uncounterableAirThreats > 0 && !snapshot.hasAntiAir) {
      // Prioritize anti-air production
      for (const rec of recommendation.unitsToBuild) {
        if (rec.priority >= 10) {
          this.tryTrainUnit(ai, rec.unitId);
          break;
        }
      }
    }
  }

  private executeRuleAction(ai: AIPlayer, action: MacroAction, _snapshot: AIStateSnapshot): boolean {
    switch (action.type) {
      case 'train':
        if (action.targetId) {
          // Pre-check resources before attempting to train
          if (!this.canAffordUnit(ai, action.targetId)) {
            return false;
          }
          return this.tryTrainUnit(ai, action.targetId);
        } else if (action.options) {
          // Filter options to only those we can afford, then do weighted random selection
          const affordableOptions = action.options.filter(opt => this.canAffordUnit(ai, opt.id));
          if (affordableOptions.length === 0) {
            return false;
          }
          const totalWeight = affordableOptions.reduce((sum: number, opt: { id: string; weight: number }) => sum + opt.weight, 0);
          let random = this.coordinator.getRandom(ai.playerId).next() * totalWeight;
          for (const option of affordableOptions) {
            random -= option.weight;
            if (random <= 0) {
              return this.tryTrainUnit(ai, option.id);
            }
          }
        }
        return false;

      case 'build':
        // Check if this is a research_module addon build
        if (action.targetId === 'research_module') {
          return this.tryBuildAddon(ai, action.targetId);
        }
        return this.tryBuildBuilding(ai, action.targetId!);

      case 'expand':
        return this.tryExpand(ai);

      case 'research':
        return this.tryStartResearch(ai, action.targetId!);

      default:
        return false;
    }
  }

  // === Building Construction ===

  /**
   * Try to build a building.
   */
  public tryBuildBuilding(ai: AIPlayer, buildingType: string): boolean {
    const config = ai.config!;
    const buildingDef = BUILDING_DEFINITIONS[buildingType];
    const currentTick = this.game.getCurrentTick();
    const shouldLog = currentTick % 100 === 0;

    if (!buildingDef) {
      debugAI.warn(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding failed - unknown building type: ${buildingType}`);
      return false;
    }

    if (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost) {
      if (shouldLog) {
        debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding - insufficient resources for ${buildingType} (need ${buildingDef.mineralCost}M/${buildingDef.vespeneCost}G, have ${Math.floor(ai.minerals)}M/${Math.floor(ai.vespene)}G)`);
      }
      return false;
    }

    // Prevent building if we already have one of this type under construction
    // This avoids duplicate build orders for the same building type
    const inProgressCount = ai.buildingsInProgress.get(buildingType) || 0;
    if (inProgressCount > 0) {
      if (shouldLog) {
        debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding - ${buildingType} already in progress (${inProgressCount})`);
      }
      return false;
    }

    // Check building requirements BEFORE attempting placement
    // This prevents invalid build attempts and resource churn
    if (buildingDef.requirements && buildingDef.requirements.length > 0) {
      for (const reqBuildingId of buildingDef.requirements) {
        const requiredCount = ai.buildingCounts.get(reqBuildingId) || 0;
        // We need at least one COMPLETE building of the required type
        // Check if we have the building and it's complete
        if (requiredCount === 0 || !this.hasCompleteBuildingOfType(ai, reqBuildingId)) {
          if (shouldLog) {
            debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding - ${buildingType} requires completed ${reqBuildingId}`);
          }
          return false;
        }
      }
    }

    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) {
      // This is a critical error - AI has no base
      debugAI.error(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding CRITICAL - cannot find AI base!`);
      return false;
    }

    const economyManager = this.getEconomyManager();
    const workerId = economyManager.findAvailableWorkerNotBuilding(ai.playerId);
    if (workerId === null) {
      if (shouldLog) {
        debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding - no available worker for ${buildingType}`);
      }
      return false;
    }

    let buildPos: { x: number; y: number } | null = null;

    // Special handling for extractors - must be placed on vespene geysers
    if (buildingType === config.roles.gasExtractor) {
      buildPos = economyManager.findAvailableVespeneGeyser(ai, basePos);
      if (!buildPos) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding - no available vespene geyser near base`);
        }
        return false;
      }
    } else {
      buildPos = this.findBuildingSpot(ai.playerId, basePos, buildingDef.width, buildingDef.height, workerId, buildingType);
      if (!buildPos) {
        if (shouldLog) {
          debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryBuildBuilding - no valid building spot for ${buildingType}`);
        }
        return false;
      }
    }

    // Resources are deducted in BuildingPlacementSystem after placement validation
    this.game.eventBus.emit('building:place', {
      buildingType,
      position: buildPos,
      playerId: ai.playerId,
      workerId,
    });

    debugAI.log(`[AIBuildOrder] ${ai.playerId}: Placed ${buildingType} at (${buildPos.x.toFixed(1)}, ${buildPos.y.toFixed(1)}) with worker ${workerId}`);

    return true;
  }

  /**
   * Find a suitable spot to place a building.
   * Uses PositionalAnalysis for strategic placement when applicable.
   * Defensive buildings are placed near choke points for better defense.
   * AI buildings are placed with extra spacing for unit pathing.
   */
  private findBuildingSpot(
    playerId: string,
    basePos: { x: number; y: number },
    width: number,
    height: number,
    excludeEntityId?: number,
    buildingType?: string
  ): { x: number; y: number } | null {
    const positionalAnalysis = this.coordinator.getPositionalAnalysis();
    const AI_BUILDING_SPACING = 2;

    // Check if this is a defensive building that should be placed near chokes
    const defensiveBuildings = ['bunker', 'turret', 'missile_turret', 'siege_turret', 'photon_cannon'];
    const isDefensiveBuilding = buildingType && defensiveBuildings.includes(buildingType);

    if (isDefensiveBuilding) {
      // Try to place near a choke point for strategic defense
      const chokePoints = positionalAnalysis.getChokePoints();
      for (const choke of chokePoints) {
        // Only consider chokes within reasonable range of base
        const distToBase = Math.sqrt(
          Math.pow(choke.x - basePos.x, 2) +
          Math.pow(choke.y - basePos.y, 2)
        );
        if (distToBase > 40) continue;

        // Try positions near the choke point
        for (let offset = 2; offset <= 8; offset += 2) {
          for (let angle = 0; angle < 8; angle++) {
            const theta = (angle * Math.PI * 2) / 8;
            const pos = {
              x: choke.x + Math.cos(theta) * offset,
              y: choke.y + Math.sin(theta) * offset,
            };

            if (!this.game.isValidBuildingPlacement(pos.x, pos.y, width, height, excludeEntityId, true)) {
              continue;
            }
            if (this.hasAdequateBuildingSpacing(pos.x, pos.y, width, height, AI_BUILDING_SPACING)) {
              debugAI.log(`[AIBuildOrder] Placing ${buildingType} near choke point at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`);
              return pos;
            }
          }
        }
      }
    }

    // Default placement: expanding rings around base
    const offsets: Array<{ x: number; y: number }> = [];

    for (let radius = 5; radius <= 40; radius += 2) {
      const angleCount = radius <= 12 ? 8 : radius <= 24 ? 12 : 16;
      for (let angle = 0; angle < angleCount; angle++) {
        const theta = (angle * Math.PI * 2) / angleCount + this.coordinator.getRandom(playerId).next() * 0.3;
        const x = Math.round(Math.cos(theta) * radius);
        const y = Math.round(Math.sin(theta) * radius);
        offsets.push({ x, y });
      }
    }

    // Shuffle in chunks for variety while preferring closer positions
    const chunkSize = 24;
    const random = this.coordinator.getRandom(playerId);
    for (let chunkStart = 0; chunkStart < offsets.length; chunkStart += chunkSize) {
      const chunkEnd = Math.min(chunkStart + chunkSize, offsets.length);
      for (let i = chunkEnd - 1; i > chunkStart; i--) {
        const j = chunkStart + Math.floor(random.next() * (i - chunkStart + 1));
        [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
      }
    }

    for (const offset of offsets) {
      const pos = { x: basePos.x + offset.x, y: basePos.y + offset.y };
      if (!this.game.isValidBuildingPlacement(pos.x, pos.y, width, height, excludeEntityId, true)) {
        continue;
      }
      if (this.hasAdequateBuildingSpacing(pos.x, pos.y, width, height, AI_BUILDING_SPACING)) {
        return pos;
      }
    }

    return null;
  }

  /**
   * Check if a building position has adequate spacing from other buildings.
   * Used by AI to ensure units can walk between buildings.
   */
  private hasAdequateBuildingSpacing(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    spacing: number
  ): boolean {
    const halfW = width / 2;
    const halfH = height / 2;

    // Query nearby buildings with extra padding for spacing check
    const queryPadding = spacing + 10;
    const nearbyBuildingIds = this.game.world.buildingGrid.queryRect(
      centerX - halfW - queryPadding,
      centerY - halfH - queryPadding,
      centerX + halfW + queryPadding,
      centerY + halfH + queryPadding
    );

    for (const buildingId of nearbyBuildingIds) {
      const entity = this.game.world.getEntity(buildingId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;

      // Skip flying buildings
      if (building.isFlying || building.state === 'lifting' ||
          building.state === 'flying' || building.state === 'landing') {
        continue;
      }

      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      // Check if buildings are too close (need spacing gap for unit pathing)
      const requiredDx = halfW + existingHalfW + spacing;
      const requiredDy = halfH + existingHalfH + spacing;

      if (dx < requiredDx && dy < requiredDy) {
        return false;
      }
    }

    return true;
  }

  // === Addon Construction ===

  /**
   * Try to build an addon on an existing building.
   */
  public tryBuildAddon(ai: AIPlayer, addonType: string): boolean {
    const buildings = this.coordinator.getCachedBuildings();

    const addonDef = BUILDING_DEFINITIONS[addonType];
    if (!addonDef) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: Unknown addon type: ${addonType}`);
      return false;
    }

    // Check resources first
    if (ai.minerals < addonDef.mineralCost || ai.vespene < addonDef.vespeneCost) {
      return false;
    }

    // Find a building that can have an addon
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;
      if (!building.canHaveAddon) continue;
      if (building.hasAddon()) continue;

      // Found a valid building - emit event (resources deducted on placement)
      this.game.eventBus.emit('building:build_addon', {
        buildingId: entity.id,
        addonType,
        playerId: ai.playerId,
      });

      debugAI.log(`[AIBuildOrder] ${ai.playerId}: Building addon ${addonType} on building ${entity.id}`);
      return true;
    }

    return false;
  }

  // === Unit Training ===

  /**
   * Try to train a unit.
   */
  public tryTrainUnit(ai: AIPlayer, unitType: string): boolean {
    const unitDef = UNIT_DEFINITIONS[unitType];
    if (!unitDef) {
      debugAI.warn(`[AIBuildOrder] ${ai.playerId}: tryTrainUnit failed - unknown unit type: ${unitType}`);
      return false;
    }

    const currentTick = this.game.getCurrentTick();
    const shouldLog = currentTick % 100 === 0;

    if (ai.minerals < unitDef.mineralCost || ai.vespene < unitDef.vespeneCost) {
      if (shouldLog) {
        debugAI.warn(`[AIBuildOrder] ${ai.playerId}: INSUFFICIENT RESOURCES for ${unitType} (need ${unitDef.mineralCost}M/${unitDef.vespeneCost}G, have ${Math.floor(ai.minerals)}M/${Math.floor(ai.vespene)}G)`);
      }
      return false;
    }
    if (ai.supply + unitDef.supplyCost > ai.maxSupply) {
      if (shouldLog) {
        debugAI.warn(`[AIBuildOrder] ${ai.playerId}: SUPPLY BLOCKED for ${unitType} (${ai.supply}+${unitDef.supplyCost} > ${ai.maxSupply})`);
      }
      return false;
    }

    const requiresResearchModule = this.unitRequiresResearchModule(unitType);

    const buildings = this.world.getEntitiesWith('Building', 'Selectable');
    let foundProducer = false;
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;
      if (!building.canProduce.includes(unitType)) continue;

      foundProducer = true;

      if (building.productionQueue.length >= 3) continue;

      if (requiresResearchModule) {
        if (!building.hasAddon() || !building.hasTechLab()) {
          continue;
        }
      }

      ai.minerals -= unitDef.mineralCost;
      ai.vespene -= unitDef.vespeneCost;
      ai.supply += unitDef.supplyCost; // Track supply used
      building.addToProductionQueue('unit', unitType, unitDef.buildTime, unitDef.supplyCost);

      debugAI.log(`[AIBuildOrder] ${ai.playerId}: Queued ${unitType} at ${building.buildingId} (minerals: ${Math.floor(ai.minerals)}, supply: ${ai.supply}/${ai.maxSupply})`);
      return true;
    }

    if (shouldLog) {
      if (!foundProducer) {
        debugAI.warn(`[AIBuildOrder] ${ai.playerId}: tryTrainUnit failed - no production building for ${unitType}. Buildings checked: ${buildings.length}`);
      } else {
        debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryTrainUnit - all ${unitType} producers busy or missing tech lab`);
      }
    }
    return false;
  }

  /**
   * Check if the AI can afford to train a unit (resources and supply).
   * Used as a pre-check before attempting training to reduce log spam.
   */
  private canAffordUnit(ai: AIPlayer, unitType: string): boolean {
    const unitDef = UNIT_DEFINITIONS[unitType];
    if (!unitDef) return false;

    if (ai.minerals < unitDef.mineralCost || ai.vespene < unitDef.vespeneCost) {
      return false;
    }
    if (ai.supply + unitDef.supplyCost > ai.maxSupply) {
      return false;
    }
    return true;
  }

  /**
   * Check if a unit type requires a research module addon.
   */
  private unitRequiresResearchModule(unitType: string): boolean {
    const unitDef = UNIT_DEFINITIONS[unitType];
    if (!unitDef) return false;

    // Units that require research module (tech lab)
    const techUnits = ['operative', 'inferno', 'colossus', 'devastator', 'dreadnought'];
    return techUnits.includes(unitType);
  }

  /**
   * Check if the AI has at least one COMPLETE building of the specified type.
   * Building counts include incomplete buildings, so we need to verify completion state.
   */
  private hasCompleteBuildingOfType(ai: AIPlayer, buildingId: string): boolean {
    const buildings = this.coordinator.getCachedBuildings();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (building.buildingId !== buildingId) continue;

      if (building.isComplete()) {
        return true;
      }
    }

    return false;
  }

  // === Research System (NEW IMPLEMENTATION) ===

  /**
   * Try to start a research upgrade at an appropriate building.
   * This implements the previously stubbed research functionality.
   */
  public tryStartResearch(ai: AIPlayer, researchId: string): boolean {
    const research = RESEARCH_DEFINITIONS[researchId];
    if (!research) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: Unknown research: ${researchId}`);
      return false;
    }

    // Check if already researched
    if (ai.completedResearch.has(researchId)) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: Research already complete: ${researchId}`);
      return true; // Return true to advance build order
    }

    // Check if already in progress
    if (ai.researchInProgress.has(researchId)) {
      return false;
    }

    // Check resources
    if (ai.minerals < research.mineralCost || ai.vespene < research.vespeneCost) {
      return false;
    }

    // Check requirements
    if (research.requirements) {
      for (const req of research.requirements) {
        // Check if requirement is a building
        if (BUILDING_DEFINITIONS[req]) {
          if (!ai.buildingCounts.has(req) || ai.buildingCounts.get(req)! === 0) {
            debugAI.log(`[AIBuildOrder] ${ai.playerId}: Research ${researchId} requires building: ${req}`);
            return false;
          }
        } else {
          // Requirement is another research
          if (!ai.completedResearch.has(req)) {
            debugAI.log(`[AIBuildOrder] ${ai.playerId}: Research ${researchId} requires research: ${req}`);
            return false;
          }
        }
      }
    }

    // Find a building that can perform this research
    const researchBuilding = this.findBuildingForResearch(ai, researchId);
    if (!researchBuilding) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: No building available for research: ${researchId}`);
      return false;
    }

    // Deduct resources
    ai.minerals -= research.mineralCost;
    ai.vespene -= research.vespeneCost;

    // Track research in progress
    ai.researchInProgress.set(researchId, researchBuilding);

    // Emit research command
    this.game.eventBus.emit('command:research', {
      entityIds: [researchBuilding],
      upgradeId: researchId,
    });

    debugAI.log(`[AIBuildOrder] ${ai.playerId}: Started research: ${researchId} at building ${researchBuilding}`);
    return true;
  }

  /**
   * Find a building that can perform the specified research.
   */
  private findBuildingForResearch(ai: AIPlayer, researchId: string): number | null {
    // Map of building types to what they can research
    const researchMap: Record<string, string[]> = {
      tech_center: [
        'infantry_weapons_1', 'infantry_weapons_2', 'infantry_weapons_3',
        'infantry_armor_1', 'infantry_armor_2', 'infantry_armor_3',
        'auto_tracking', 'building_armor',
      ],
      arsenal: [
        'vehicle_weapons_1', 'vehicle_weapons_2', 'vehicle_weapons_3',
        'vehicle_armor_1', 'vehicle_armor_2', 'vehicle_armor_3',
        'ship_weapons_1', 'ship_weapons_2', 'ship_weapons_3',
        'ship_armor_1', 'ship_armor_2', 'ship_armor_3',
      ],
      power_core: ['nova_cannon', 'dreadnought_weapon_refit'],
      infantry_bay: ['combat_stim', 'combat_shield', 'concussive_shells'],
      forge: ['bombardment_systems', 'drilling_claws'],
      hangar: ['cloaking_field', 'medical_reactor'],
      ops_center: ['stealth_systems', 'enhanced_reactor'],
    };

    // Find which building type can research this
    let targetBuildingType: string | null = null;
    for (const [buildingType, researches] of Object.entries(researchMap)) {
      if (researches.includes(researchId)) {
        targetBuildingType = buildingType;
        break;
      }
    }

    if (!targetBuildingType) {
      return null;
    }

    // Find an available building of this type
    const buildings = this.coordinator.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isComplete()) continue;
      if (building.buildingId !== targetBuildingType) continue;

      // Check if building is already researching
      const isResearching = building.productionQueue.some(
        (item) => item.type === 'upgrade'
      );
      if (isResearching) continue;

      return entity.id;
    }

    return null;
  }

  // === Ability Execution ===

  /**
   * Try to use an ability as part of a build order step.
   * Supports scanner_sweep, mule, and supply_drop abilities.
   */
  public tryUseAbility(ai: AIPlayer, abilityId: string): boolean {
    const abilityDef = DOMINION_ABILITIES[abilityId];
    if (!abilityDef) {
      debugAI.warn(`[AIBuildOrder] ${ai.playerId}: Unknown ability: ${abilityId}`);
      return false;
    }

    // Find a caster entity that can use this ability
    const caster = this.findAbilityCaster(ai, abilityId);
    if (!caster) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: No caster available for ability: ${abilityId}`);
      return false;
    }

    // Determine target based on ability type
    const target = this.determineAbilityTarget(ai, abilityId, abilityDef.targetType, caster);
    if (!target && (abilityDef.targetType === 'point' || abilityDef.targetType === 'unit')) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: No valid target for ability: ${abilityId}`);
      return false;
    }

    // Emit the ability command
    this.game.eventBus.emit('command:ability', {
      entityIds: [caster.entityId],
      abilityId,
      targetPosition: target?.position,
      targetEntityId: target?.entityId,
    });

    debugAI.log(`[AIBuildOrder] ${ai.playerId}: Used ability ${abilityId} from entity ${caster.entityId}`);
    return true;
  }

  /**
   * Find an entity that can cast the specified ability.
   * Returns the entity ID and its position.
   */
  private findAbilityCaster(
    ai: AIPlayer,
    abilityId: string
  ): { entityId: number; position: { x: number; y: number } } | null {
    // Check buildings first (for abilities like scanner_sweep, mule, supply_drop from command center)
    const buildings = this.coordinator.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;
      const ability = entity.get<Ability>('Ability');
      const transform = entity.get<Transform>('Transform');

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isComplete()) continue;
      if (!ability || !transform) continue;

      // Check if this entity has the ability and can use it
      if (ability.canUseAbility(abilityId)) {
        return {
          entityId: entity.id,
          position: { x: transform.x, y: transform.y },
        };
      }
    }

    // Check units (for abilities like stim, siege mode, etc.)
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Ability', 'Health');
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const ability = entity.get<Ability>('Ability')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (ability.canUseAbility(abilityId)) {
        return {
          entityId: entity.id,
          position: { x: transform.x, y: transform.y },
        };
      }
    }

    return null;
  }

  /**
   * Determine the target for an ability based on its target type.
   */
  private determineAbilityTarget(
    ai: AIPlayer,
    abilityId: string,
    targetType: string,
    caster: { entityId: number; position: { x: number; y: number } }
  ): { position?: { x: number; y: number }; entityId?: number } | null {
    switch (targetType) {
      case 'none':
      case 'self':
        // Self-cast abilities don't need a target
        return {};

      case 'point':
        return this.determinePointTarget(ai, abilityId, caster);

      case 'unit':
      case 'ally':
        return this.determineUnitTarget(ai, abilityId, targetType);

      default:
        return null;
    }
  }

  /**
   * Determine a point target for abilities like scanner_sweep, mule.
   */
  private determinePointTarget(
    ai: AIPlayer,
    abilityId: string,
    caster: { entityId: number; position: { x: number; y: number } }
  ): { position: { x: number; y: number } } | null {
    switch (abilityId) {
      case 'scanner_sweep': {
        // Target enemy base if known, otherwise scout unexplored areas
        if (ai.enemyBaseLocation) {
          // Add some randomness to avoid always scanning the exact same spot
          const random = this.coordinator.getRandom(ai.playerId);
          const offsetX = (random.next() - 0.5) * 10;
          const offsetY = (random.next() - 0.5) * 10;
          return {
            position: {
              x: ai.enemyBaseLocation.x + offsetX,
              y: ai.enemyBaseLocation.y + offsetY,
            },
          };
        }
        // No enemy base known - scan center of map or last contact location
        return {
          position: {
            x: this.game.config.mapWidth / 2,
            y: this.game.config.mapHeight / 2,
          },
        };
      }

      case 'mule': {
        // Target a mineral patch near a base
        const mineralTarget = this.findMineralPatchNearBase(ai);
        if (mineralTarget) {
          return { position: mineralTarget };
        }
        // Fallback to near the caster
        return { position: caster.position };
      }

      case 'nuke':
      case 'emp_round': {
        // Target enemy army concentration
        if (ai.enemyBaseLocation) {
          return { position: ai.enemyBaseLocation };
        }
        return null;
      }

      default:
        // Generic point ability - target near caster
        return { position: caster.position };
    }
  }

  /**
   * Determine a unit target for abilities like supply_drop.
   */
  private determineUnitTarget(
    ai: AIPlayer,
    abilityId: string,
    targetType: string
  ): { entityId: number } | null {
    switch (abilityId) {
      case 'supply_drop': {
        // Find an incomplete supply_cache
        const buildings = this.coordinator.getCachedBuildings();
        for (const entity of buildings) {
          const selectable = entity.get<Selectable>('Selectable')!;
          const building = entity.get<Building>('Building')!;
          const health = entity.get<Health>('Health')!;

          if (selectable.playerId !== ai.playerId) continue;
          if (health.isDead()) continue;
          if (building.buildingId !== 'supply_cache') continue;
          if (building.state !== 'constructing') continue;

          return { entityId: entity.id };
        }
        return null;
      }

      case 'snipe':
      case 'power_cannon': {
        // Target high-value enemy units
        const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
        let bestTarget: { entityId: number; value: number } | null = null;

        for (const entity of units) {
          const selectable = entity.get<Selectable>('Selectable')!;
          const health = entity.get<Health>('Health')!;
          const unit = entity.get<Unit>('Unit')!;

          if (selectable.playerId === ai.playerId) continue; // Enemy only
          if (health.isDead()) continue;

          // For snipe, prefer biological targets
          if (abilityId === 'snipe' && !unit.isBiological) continue;

          const value = health.max + (unit.attackDamage * 10);
          if (!bestTarget || value > bestTarget.value) {
            bestTarget = { entityId: entity.id, value };
          }
        }
        return bestTarget ? { entityId: bestTarget.entityId } : null;
      }

      default:
        return null;
    }
  }

  /**
   * Find a mineral patch near one of the AI's bases.
   */
  private findMineralPatchNearBase(ai: AIPlayer): { x: number; y: number } | null {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return null;

    const resources = this.coordinator.getCachedResources();
    let closestMineral: { x: number; y: number; dist: number } | null = null;

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'minerals') continue;
      if (resource.isDepleted()) continue;

      const dist = distance(basePos.x, basePos.y, transform.x, transform.y);

      // Only consider minerals within reasonable range of base
      if (dist > 25) continue;

      if (!closestMineral || dist < closestMineral.dist) {
        closestMineral = { x: transform.x, y: transform.y, dist };
      }
    }

    return closestMineral ? { x: closestMineral.x, y: closestMineral.y } : null;
  }

  // === Expansion ===

  /**
   * Try to expand to a new base location.
   */
  public tryExpand(ai: AIPlayer): boolean {
    const config = ai.config!;
    const diffConfig = config.difficultyConfig[ai.difficulty];

    // Check if we've hit the max bases for this difficulty
    const currentBases = this.coordinator.countPlayerBases(ai);
    if (currentBases >= diffConfig.maxBases) {
      return false;
    }

    // Get expansion building type (usually an upgraded command center)
    const expansionType = config.roles.baseTypes[1] || config.roles.mainBase;
    const buildingDef = BUILDING_DEFINITIONS[expansionType];
    if (!buildingDef) {
      return false;
    }

    // Check resources
    if (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost) {
      return false;
    }

    // Prevent expanding if we already have an expansion under construction
    const inProgressCount = ai.buildingsInProgress.get(expansionType) || 0;
    if (inProgressCount > 0) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: tryExpand - ${expansionType} already in progress`);
      return false;
    }

    // Find expansion location
    const expansionLocation = this.findExpansionLocation(ai);
    if (!expansionLocation) {
      debugAI.log(`[AIBuildOrder] ${ai.playerId}: No expansion location found`);
      return false;
    }

    const economyManager = this.getEconomyManager();
    const workerId = economyManager.findAvailableWorkerNotBuilding(ai.playerId);
    if (workerId === null) {
      return false;
    }

    // Resources are deducted in BuildingPlacementSystem after placement validation
    this.game.eventBus.emit('building:place', {
      buildingType: expansionType,
      position: expansionLocation,
      playerId: ai.playerId,
      workerId,
    });

    debugAI.log(`[AIBuildOrder] ${ai.playerId}: Expanding to (${expansionLocation.x.toFixed(1)}, ${expansionLocation.y.toFixed(1)})`);
    return true;
  }

  /**
   * Find a suitable expansion location (near mineral patches).
   * Uses PositionalAnalysis for pre-analyzed expansion locations when available.
   */
  private findExpansionLocation(ai: AIPlayer): { x: number; y: number } | null {
    const positionalAnalysis = this.coordinator.getPositionalAnalysis();
    const existingBases = this.coordinator.getAIBasePositions(ai);
    const buildings = this.coordinator.getCachedBuildingsWithTransform();

    // Get enemy bases to avoid
    const enemyBases: Array<{ x: number; y: number }> = [];
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === ai.playerId) continue;
      if (ai.config!.roles.baseTypes.includes(building.buildingId)) {
        enemyBases.push({ x: transform.x, y: transform.y });
      }
    }

    // First try to use PositionalAnalysis expansion locations
    const expansionLocations = positionalAnalysis.getExpansionLocations();

    if (expansionLocations.length > 0) {
      // Score each expansion location
      const scoredLocations = expansionLocations.map(loc => {
        let score = 100;

        // Penalize if too close to existing bases
        for (const base of existingBases) {
          const dist = Math.sqrt(Math.pow(loc.x - base.x, 2) + Math.pow(loc.y - base.y, 2));
          if (dist < 30) {
            score -= 1000; // Disqualify
          } else if (dist < 50) {
            score -= 50;
          }
        }

        // Penalize if close to enemy bases
        for (const enemyBase of enemyBases) {
          const dist = Math.sqrt(Math.pow(loc.x - enemyBase.x, 2) + Math.pow(loc.y - enemyBase.y, 2));
          if (dist < 25) {
            score -= 500;
          } else if (dist < 40) {
            score -= 100;
          }
        }

        // Prefer closer expansions (shorter travel distance for workers)
        const distToMain = existingBases.length > 0
          ? Math.sqrt(Math.pow(loc.x - existingBases[0].x, 2) + Math.pow(loc.y - existingBases[0].y, 2))
          : 0;
        score -= distToMain * 0.5;

        return { location: loc, score };
      });

      // Sort by score descending
      scoredLocations.sort((a, b) => b.score - a.score);

      // Try each location
      for (const { location, score } of scoredLocations) {
        if (score < 0) continue; // Skip disqualified locations

        const buildPos = { x: location.x + 5, y: location.y + 5 };
        const buildingDef = BUILDING_DEFINITIONS[ai.config!.roles.mainBase];

        if (this.game.isValidBuildingPlacement(buildPos.x, buildPos.y, buildingDef.width, buildingDef.height, undefined, true)) {
          debugAI.log(`[AIBuildOrder] Using analyzed expansion location at (${buildPos.x.toFixed(0)}, ${buildPos.y.toFixed(0)})`);
          return buildPos;
        }
      }
    }

    // Fallback: manual mineral cluster detection
    const resources = this.coordinator.getCachedResources();

    interface MineralCluster {
      x: number;
      y: number;
      mineralCount: number;
      distanceToNearestBase: number;
    }

    const mineralClusters: MineralCluster[] = [];
    const visited = new Set<string>();

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'minerals') continue;
      if (resource.isDepleted()) continue;

      const key = `${Math.floor(transform.x / 20)},${Math.floor(transform.y / 20)}`;
      if (visited.has(key)) continue;
      visited.add(key);

      // Check distance to existing bases
      let distanceToNearestBase = Infinity;
      for (const base of existingBases) {
        const dx = transform.x - base.x;
        const dy = transform.y - base.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        distanceToNearestBase = Math.min(distanceToNearestBase, dist);
      }

      if (distanceToNearestBase < 30) continue;

      // Check enemy proximity
      let tooCloseToEnemy = false;
      for (const enemyBase of enemyBases) {
        const dx = transform.x - enemyBase.x;
        const dy = transform.y - enemyBase.y;
        if (Math.sqrt(dx * dx + dy * dy) < 25) {
          tooCloseToEnemy = true;
          break;
        }
      }
      if (tooCloseToEnemy) continue;

      // Count nearby minerals
      let mineralCount = 0;
      for (const other of resources) {
        const otherResource = other.get<Resource>('Resource');
        const otherTransform = other.get<Transform>('Transform');

        if (!otherResource || !otherTransform) continue;
        if (otherResource.resourceType !== 'minerals') continue;

        const dx = otherTransform.x - transform.x;
        const dy = otherTransform.y - transform.y;
        if (Math.sqrt(dx * dx + dy * dy) < 15) {
          mineralCount++;
        }
      }

      if (mineralCount >= 3) {
        mineralClusters.push({
          x: transform.x,
          y: transform.y,
          mineralCount,
          distanceToNearestBase,
        });
      }
    }

    // Sort by mineral count then distance
    mineralClusters.sort((a, b) => {
      if (b.mineralCount !== a.mineralCount) {
        return b.mineralCount - a.mineralCount;
      }
      return a.distanceToNearestBase - b.distanceToNearestBase;
    });

    for (const cluster of mineralClusters) {
      const buildPos = { x: cluster.x + 5, y: cluster.y + 5 };
      const buildingDef = BUILDING_DEFINITIONS[ai.config!.roles.mainBase];

      if (this.game.isValidBuildingPlacement(buildPos.x, buildPos.y, buildingDef.width, buildingDef.height, undefined, true)) {
        return buildPos;
      }
    }

    return null;
  }
}
